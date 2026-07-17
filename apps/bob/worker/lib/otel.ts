/**
 * Standalone OTel instrumentation for CF Workers.
 * Copy this single file into any app — zero dependencies.
 *
 * Usage:
 *   import { wrapFetch } from "./otel";
 *   export default { fetch: wrapFetch(originalFetch) };
 */

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException?(): void;
}

type FetchHandler = (request: Request, env: Record<string, unknown> | undefined, ctx: ExecutionContext) => Promise<Response>;

interface InstrumentOptions {
  serviceName?: string;
  sampleRate?: number;
  endpoint?: string;
}

interface TraceContext {
  traceId: string;
  parentSpanId?: string;
  sampled: boolean;
}

function parseTraceparent(header: string | null): TraceContext | null {
  if (!header) return null;
  const parts = header.split("-");
  if (parts.length < 4) return null;
  const version = parts[0]!;
  const traceId = parts[1]!;
  const parentId = parts[2]!;
  const flags = parts[3]!;
  if (version !== "00" || traceId.length !== 32 || parentId.length !== 16) return null;
  return { traceId, parentSpanId: parentId, sampled: (parseInt(flags, 16) & 1) === 1 };
}

function buildTraceparent(traceId: string, spanId: string): string {
  return `00-${traceId}-${spanId}-01`;
}

export function wrapFetch(handler: FetchHandler, options?: InstrumentOptions): FetchHandler {
  return async (request, env, ctx) => {
    const runtimeEnv =
      env ?? (typeof process !== "undefined" && process.env ? process.env : {});
    const runtimeCtx = ctx ?? {
      waitUntil() {},
    };
    const serviceName = options?.serviceName ?? (runtimeEnv.FG_APP as string) ?? "unknown";
    const endpoint = options?.endpoint ?? (runtimeEnv.OTEL_ENDPOINT as string) ?? "https://otlp.forgegraf.com";
    const disabled = (runtimeEnv.OTEL_DISABLED as string) === "true";
    const sampleRate = options?.sampleRate ?? 1.0;

    if (disabled || (sampleRate < 1.0 && Math.random() >= sampleRate)) {
      return handler(request, runtimeEnv, runtimeCtx);
    }

    const incoming = parseTraceparent(request.headers.get("traceparent"));
    const traceId = incoming?.traceId ?? hex(16);
    const spanId = hex(8);

    const start = Date.now();
    let response: Response;
    let error: unknown;

    try {
      response = await handler(request, runtimeEnv, runtimeCtx);
    } catch (err) {
      error = err;
      response = new Response("Internal Server Error", { status: 500 });
    }

    const latencyMs = Date.now() - start;
    const url = new URL(request.url);

    runtimeCtx.waitUntil(
      pushSpan({
        endpoint,
        serviceName,
        stage: runtimeEnv.FG_STAGE as string,
        method: request.method,
        path: url.pathname,
        status: response.status,
        latencyMs,
        traceId,
        spanId,
        parentSpanId: incoming?.parentSpanId,
        error: error ? String(error) : undefined,
      }).catch(() => {}),
    );

    if (error) throw error;

    const headers = new Headers(response.headers);
    headers.set("X-Fg-Trace", traceId);
    headers.set("traceparent", buildTraceparent(traceId, spanId));
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
  };
}

async function pushSpan(opts: {
  endpoint: string;
  serviceName: string;
  stage?: string;
  method: string;
  path: string;
  status: number;
  latencyMs: number;
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  error?: string;
}) {
  const now = BigInt(Date.now()) * 1000000n;
  const startTime = (now - BigInt(opts.latencyMs) * 1000000n).toString();
  const endTime = now.toString();

  const attributes = [
    { key: "http.method", value: { stringValue: opts.method } },
    { key: "http.target", value: { stringValue: opts.path } },
    { key: "http.status_code", value: { intValue: String(opts.status) } },
    { key: "http.latency_ms", value: { intValue: String(opts.latencyMs) } },
    { key: "fg.trace_url", value: { stringValue: `https://forgegraf.com/traces/${opts.traceId}` } },
  ];
  if (opts.stage) attributes.push({ key: "deployment.environment", value: { stringValue: opts.stage } });
  if (opts.error) attributes.push({ key: "exception.message", value: { stringValue: opts.error } });

  const resourceAttrs = [
    { key: "service.name", value: { stringValue: opts.serviceName } },
  ];
  if (opts.stage) resourceAttrs.push({ key: "deployment.environment", value: { stringValue: opts.stage } });

  const span: Record<string, unknown> = {
    traceId: opts.traceId,
    spanId: opts.spanId,
    name: `${opts.method} ${opts.path}`,
    kind: 2,
    startTimeUnixNano: startTime,
    endTimeUnixNano: endTime,
    attributes,
    status: { code: opts.status >= 500 ? 2 : 1 },
  };
  if (opts.parentSpanId) span.parentSpanId = opts.parentSpanId;

  const payload = {
    resourceSpans: [{
      resource: { attributes: resourceAttrs },
      scopeSpans: [{
        scope: { name: "@forgegraph/otel" },
        spans: [span],
      }],
    }],
  };

  await fetch(`${opts.endpoint}/v1/traces`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

function hex(bytes: number): string {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return Array.from(arr, (b) => b.toString(16).padStart(2, "0")).join("");
}
