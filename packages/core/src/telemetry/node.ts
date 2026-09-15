/** Node-only SDK and HTTP boundary. Keep this out of Worker dependency graphs. */
import type { IncomingMessage, ServerResponse, Server } from "node:http";
import type { ContextManager, TextMapPropagator } from "@opentelemetry/api";
import {
  context,
  propagation,
  trace,
  diag,
  DiagLogLevel,
  SpanKind,
  SpanStatusCode,
} from "@opentelemetry/api";
import {
  CompositePropagator,
  W3CTraceContextPropagator,
} from "@opentelemetry/core";
import { NodeSDK } from "@opentelemetry/sdk-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { BatchSpanProcessor } from "@opentelemetry/sdk-trace-base";

let sdk: NodeSDK | undefined;
let processor: BatchSpanProcessor | undefined;
let shuttingDown: Promise<void> | undefined;

export interface TelemetryConfig {
  serviceName: string;
  serviceVersion?: string;
  /** Base OTLP/HTTP endpoint. The signal-specific environment endpoint takes precedence. */
  endpoint?: string;
  disabled?: boolean;
  /** Optional adapters for an error-reporting SDK sharing this provider. */
  contextManager?: ContextManager;
  textMapPropagator?: TextMapPropagator;
}

function resolveTraceEndpoint(config?: TelemetryConfig): string | undefined {
  const signal = process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT?.trim();
  const base =
    config?.endpoint?.trim() ||
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT?.trim() ||
    process.env.SIGNOZ_ENDPOINT?.trim();
  return signal || (base ? `${base.replace(/\/+$/, "")}/v1/traces` : undefined);
}

export function isTelemetryEnabled(config?: TelemetryConfig): boolean {
  return (
    !config?.disabled &&
    process.env.OTEL_SDK_DISABLED?.toLowerCase() !== "true" &&
    Boolean(resolveTraceEndpoint(config))
  );
}

export function initTelemetry(config: TelemetryConfig): void {
  if (sdk || shuttingDown || !isTelemetryEnabled(config)) return;
  const url = resolveTraceEndpoint(config)!;
  // SDK diagnostics can include collector URLs and headers; report failure without
  // forwarding their arguments to application logs.
  diag.setLogger(
    {
      error: () =>
        console.error(
          "[telemetry] SDK or OTLP export error (details redacted)",
        ),
      warn: () => console.warn("[telemetry] SDK warning (details redacted)"),
      info: () => {},
      debug: () => {},
      verbose: () => {},
    },
    DiagLogLevel.WARN,
  );
  // Exporter reads standard general/signal-specific authentication headers itself.
  processor = new BatchSpanProcessor(
    new OTLPTraceExporter({ url, timeoutMillis: 5_000 }),
    {
      exportTimeoutMillis: 7_000,
    },
  );
  sdk = new NodeSDK({
    ...(config.contextManager ? { contextManager: config.contextManager } : {}),
    ...(config.textMapPropagator
      ? {
          textMapPropagator: new CompositePropagator({
            propagators: [
              config.textMapPropagator,
              new W3CTraceContextPropagator(),
            ],
          }),
        }
      : {}),
    resource: resourceFromAttributes({
      "service.name": process.env.OTEL_SERVICE_NAME || config.serviceName,
      "service.version":
        config.serviceVersion ??
        process.env.APP_VERSION ??
        process.env.npm_package_version ??
        "0.0.0",
      "deployment.environment.name":
        process.env.OTEL_DEPLOYMENT_ENVIRONMENT ??
        process.env.NODE_ENV ??
        "development",
    }),
    spanProcessors: [processor],
  });
  sdk.start();
  // Never log exporter URLs or headers: both can carry credentials.
  console.info("[telemetry] OTLP trace publishing enabled");
}

export async function flushTelemetry(): Promise<void> {
  await processor?.forceFlush();
}

/** The owning service must await this before process.exit(). */
export async function shutdownTelemetry(): Promise<void> {
  if (shuttingDown) return shuttingDown;
  if (!sdk) return;
  shuttingDown = sdk.shutdown();
  try {
    await shuttingDown;
  } finally {
    sdk = undefined;
    processor = undefined;
    shuttingDown = undefined;
  }
}

type Handler = (
  req: IncomingMessage,
  res: ServerResponse,
) => void | Promise<void>;
/** Explicit instrumentation works with ESM/bundles and never records raw URLs or payloads. */
export function traceHttpRequest(
  handler: Handler,
  routes: readonly string[] = [],
): Handler {
  return (req, res) => {
    const path = req.url?.split("?")[0] ?? "/";
    const route = routes.includes(path) ? path : undefined;
    const method = [
      "GET",
      "POST",
      "PUT",
      "PATCH",
      "DELETE",
      "HEAD",
      "OPTIONS",
    ].includes(req.method ?? "")
      ? req.method!
      : "_OTHER";
    // Extract only W3C trace headers. Never propagate untrusted baggage into app spans.
    const parent = propagation.extract(context.active(), {
      traceparent: req.headers.traceparent,
      tracestate: req.headers.tracestate,
    });
    return trace.getTracer("@gmacko/core/http").startActiveSpan(
      route ? `${method} ${route}` : method,
      {
        kind: SpanKind.SERVER,
        attributes: {
          "http.request.method": method,
          ...(route ? { "http.route": route } : {}),
        },
      },
      parent,
      async (span) => {
        let ended = false;
        const finish = () => {
          if (ended) return;
          ended = true;
          res.off("finish", finish);
          res.off("close", finish);
          span.setAttribute("http.response.status_code", res.statusCode);
          if (res.statusCode >= 500 || !res.writableFinished)
            span.setStatus({ code: SpanStatusCode.ERROR });
          span.end();
        };
        res.once("finish", finish);
        res.once("close", finish);
        try {
          await handler(req, res);
        } catch {
          // Exception text may contain prompts, URLs, or credentials.
          span.setStatus({ code: SpanStatusCode.ERROR });
          if (!res.headersSent) res.writeHead(500);
          res.end();
          finish();
        }
      },
    );
  };
}

const instrumentedServers = new WeakSet<Server>();
/** Instrument a framework-owned server after it has installed its request listener. */
export function instrumentHttpServer(
  server: Server,
  routes: readonly string[] = [],
): void {
  if (instrumentedServers.has(server)) return;
  const listeners = server.rawListeners("request");
  if (!listeners.length)
    throw new Error("HTTP server has no request handler to instrument");
  server.removeAllListeners("request");
  server.on(
    "request",
    traceHttpRequest(async (req, res) => {
      await Promise.all(
        listeners.map((listener) => listener.call(server, req, res)),
      );
    }, routes),
  );
  instrumentedServers.add(server);
}
