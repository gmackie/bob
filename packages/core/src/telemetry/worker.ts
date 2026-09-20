/** OTLP/HTTP JSON request spans for Cloudflare Workers. */
import {
  runWithWorkerTrace,
  validateTraceCarrier,
  type WorkerSpan,
} from "./deep";
interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
}

type FetchHandler<E, C> = (
  request: Request,
  env: E,
  ctx: C,
) => Promise<Response>;

export interface WorkerTelemetryOptions {
  serviceName: string;
  /** Base OTLP URL; /v1/traces is appended. */
  endpoint?: string;
  sampleRate?: number;
}

function traceParent(header: string | null) {
  const match = header?.match(
    /^00-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/,
  );
  if (!match || /^0+$/.test(match[1]!) || /^0+$/.test(match[2]!))
    return undefined;
  return {
    traceId: match[1]!,
    parentSpanId: match[2]!,
    sampled: (parseInt(match[3]!, 16) & 1) === 1,
  };
}

function hex(bytes: number) {
  return Array.from(crypto.getRandomValues(new Uint8Array(bytes)), (n) =>
    n.toString(16).padStart(2, "0"),
  ).join("");
}

// Unknown routes and user values are never exported verbatim. Explicit token
// routes stay redacted even when the token happens to be a dictionary word.
const staticSegments = new Set(
  (
    "api v1 health openapi auth sso status handoff accept runner events stream " +
    "trpc rpc webhooks linear internal hermes-origin-auth hermes overview operator notifications " +
    "tts-streams tts-grants conversations chat completions models workspaces heartbeat tasks " +
    "forge register projects dispatch intakes device code token approve work-items runs artifacts " +
    "mark-all-notifications-as-read list-comments list-notifications create-artifact get " +
    "create-comment promote-to-task mark-notification-as-read list list-current-artifacts " +
    "list-child-artifact-groups list-activities create-notification create " +
    "sessions ws threads planning review plan workspace pull-requests providers nodes " +
    "_vinext image _next static login logout sign-in sign-up callback settings"
  ).split(" "),
);

function routeName(pathname: string) {
  const parts = pathname.split("/");
  return parts
    .map((part, i) => {
      if (!part) return "";
      const previous = parts[i - 1];
      const pageId =
        i === 2 &&
        [
          "sessions",
          "threads",
          "work-items",
          "runs",
          "pull-requests",
          "projects",
          "nodes",
          "providers",
          "device",
        ].includes(parts[1]!);
      const apiId =
        i === 4 &&
        parts[1] === "api" &&
        parts[2] === "v1" &&
        (["tts-streams", "conversations", "workspaces", "runs"].includes(
          parts[3]!,
        ) ||
          (parts[3] === "work-items" && parts[5] === "runs"));
      if (
        pageId ||
        apiId ||
        previous === "tts-streams" ||
        previous === "conversations" ||
        previous === "threads"
      )
        return ":id";
      return staticSegments.has(part) ? part : ":id";
    })
    .join("/");
}

function diagnostic(reason: string, details: Record<string, number> = {}) {
  // Never print collector URLs, response bodies, auth headers or exception text.
  console.warn("[otel] Worker trace export failed", { reason, ...details });
}

class ExportFailure extends Error {}

function setting(env: Record<string, unknown> | undefined, name: string) {
  const value = env?.[name];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function exportConfiguration(
  env: Record<string, unknown> | undefined,
  options: WorkerTelemetryOptions,
) {
  const specific =
    !options.endpoint && setting(env, "OTEL_EXPORTER_OTLP_TRACES_ENDPOINT");
  const endpoint = new URL(
    specific ||
      options.endpoint ||
      setting(env, "OTEL_EXPORTER_OTLP_ENDPOINT") ||
      setting(env, "OTEL_ENDPOINT") ||
      "https://otlp.forgegraf.com",
  );
  if (
    !["http:", "https:"].includes(endpoint.protocol) ||
    endpoint.username ||
    endpoint.password
  )
    throw new ExportFailure("invalid_configuration");
  if (!specific)
    endpoint.pathname = `${endpoint.pathname.replace(/\/+$/, "")}/v1/traces`;
  endpoint.hash = "";
  const headers = new Headers();
  const configuredHeaders =
    setting(env, "OTEL_EXPORTER_OTLP_TRACES_HEADERS") ??
    setting(env, "OTEL_EXPORTER_OTLP_HEADERS");
  for (const pair of configuredHeaders?.split(",") ?? []) {
    const separator = pair.indexOf("=");
    if (separator < 1) throw new ExportFailure("invalid_configuration");
    headers.set(
      pair.slice(0, separator).trim(),
      decodeURIComponent(pair.slice(separator + 1).trim()),
    );
  }
  headers.set("content-type", "application/json");
  const configuredTimeout = Number(
    setting(env, "OTEL_EXPORTER_OTLP_TRACES_TIMEOUT") ??
      setting(env, "OTEL_EXPORTER_OTLP_TIMEOUT") ??
      5000,
  );
  const timeout =
    Number.isFinite(configuredTimeout) && configuredTimeout > 0
      ? Math.min(configuredTimeout, 10_000)
      : 5000;
  return { endpoint: endpoint.toString(), headers, timeout };
}

async function readAcknowledgement(response: Response) {
  // OTLP JSON response bodies are normally {}. Bound decoded input as well as
  // elapsed time, including collectors that stall after sending HTTP headers.
  const reader = response.body?.getReader();
  let text = "";
  let bytes = 0;
  const decoder = new TextDecoder();
  try {
    if (reader)
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > 65_536) {
          await reader.cancel();
          throw new ExportFailure("response_too_large");
        }
        text += decoder.decode(value, { stream: true });
      }
  } finally {
    reader?.releaseLock();
  }
  text += decoder.decode();
  let result;
  try {
    result = text ? JSON.parse(text) : {};
  } catch {
    throw new ExportFailure("invalid_response");
  }
  if (!result || typeof result !== "object" || Array.isArray(result))
    throw new ExportFailure("invalid_response");
  const partial = result.partialSuccess;
  if (partial && (Number(partial.rejectedSpans) > 0 || partial.errorMessage)) {
    const rejected = Number(partial.rejectedSpans);
    diagnostic("partial_success", {
      rejectedSpans: Number.isFinite(rejected) ? rejected : 0,
    });
  }
}

async function pushSpan(
  env: Record<string, unknown> | undefined,
  options: WorkerTelemetryOptions,
  body: string,
) {
  let config;
  try {
    config = exportConfiguration(env, options);
  } catch {
    diagnostic("invalid_configuration");
    return;
  }
  const controller = new AbortController();
  const deadline = Date.now() + config.timeout;
  const timer = setTimeout(() => controller.abort(), config.timeout);
  try {
    // One bounded retry for transient transport/OTLP failures. Partial success
    // and permanent errors must never be retried (OTLP specification).
    for (let attempt = 1; attempt <= 2; attempt++) {
      let response;
      try {
        response = await fetch(config.endpoint, {
          method: "POST",
          headers: config.headers,
          body,
          signal: controller.signal,
          redirect: "manual",
        });
      } catch {
        if (controller.signal.aborted) throw new ExportFailure("timeout");
        if (attempt === 2) throw new ExportFailure("network_error");
        diagnostic("network_error", { attempt });
      }
      if (response?.ok) {
        await readAcknowledgement(response);
        return;
      }
      if (response) {
        await response.body?.cancel();
        diagnostic("http_error", { status: response.status, attempt });
        if (![429, 502, 503, 504].includes(response.status) || attempt === 2)
          return;
      }
      const retryAfter = response?.headers.get("retry-after");
      const requestedDelay = retryAfter
        ? /^\d+$/.test(retryAfter)
          ? Number(retryAfter) * 1000
          : Date.parse(retryAfter) - Date.now()
        : 0;
      const delay = Math.max(
        100 + Math.random() * 100,
        Number.isFinite(requestedDelay) ? requestedDelay : 0,
      );
      if (Date.now() + delay >= deadline) {
        diagnostic("retry_budget_exhausted");
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  } catch (error) {
    diagnostic(
      controller.signal.aborted
        ? "timeout"
        : error instanceof ExportFailure
          ? error.message
          : "invalid_response",
    );
  } finally {
    clearTimeout(timer);
  }
}

/** Instruments the response headers boundary; never reads an application body. */
export function wrapFetch<
  E extends Record<string, unknown> | undefined,
  C extends ExecutionContext,
>(
  handler: FetchHandler<E, C>,
  options: WorkerTelemetryOptions,
): FetchHandler<E, C> {
  return async (request, env, ctx) => {
    if (
      setting(env, "OTEL_DISABLED")?.toLowerCase() === "true" ||
      setting(env, "OTEL_SDK_DISABLED")?.toLowerCase() === "true"
    )
      return handler(request, env, ctx);
    const parent = traceParent(request.headers.get("traceparent"));
    const sampled = parent
      ? parent.sampled
      : Math.random() < (options.sampleRate ?? 1);

    const traceId = parent?.traceId ?? hex(16);
    const spanId = hex(8);
    const start = Date.now();
    const route = routeName(new URL(request.url).pathname);
    let status = 500;
    const emit = (span: WorkerSpan) => {
      const body = JSON.stringify({
        resourceSpans: [
          {
            resource: {
              attributes: [
                {
                  key: "service.name",
                  value: { stringValue: options.serviceName },
                },
                {
                  key: "deployment.environment",
                  value: {
                    stringValue:
                      setting(env, "FG_STAGE") ??
                      setting(env, "NODE_ENV") ??
                      "production",
                  },
                },
              ],
            },
            scopeSpans: [
              {
                scope: { name: "@gmacko/core/telemetry/worker" },
                spans: [span],
              },
            ],
          },
        ],
      });
      try {
        ctx.waitUntil(pushSpan(env, options, body));
      } catch {
        diagnostic("wait_until_unavailable");
      }
    };
    try {
      const response = await runWithWorkerTrace(
        { traceId, spanId, sampled },
        validateTraceCarrier({
          traceparent: request.headers.get("traceparent"),
          tracestate: request.headers.get("tracestate"),
        }),
        emit,
        () => handler(request, env, ctx),
      );
      status = response.status;
      // A CF 101 carries a webSocket extension that Response reconstruction loses.
      if (status === 101 || !sampled) return response;
      try {
        response.headers.set("x-fg-trace", traceId);
        response.headers.set("traceparent", `00-${traceId}-${spanId}-01`);
        return response;
      } catch {
        const headers = new Headers(response.headers);
        headers.set("x-fg-trace", traceId);
        headers.set("traceparent", `00-${traceId}-${spanId}-01`);
        return new Response(response.body, {
          status,
          statusText: response.statusText,
          headers,
        });
      }
    } finally {
      if (sampled) {
        const end = Date.now();
        const attributes = [
          {
            key: "http.request.method",
            value: { stringValue: request.method },
          },
          { key: "http.route", value: { stringValue: route } },
          {
            key: "http.response.status_code",
            value: { intValue: String(status) },
          },
        ];
        const resourceAttributes = [
          { key: "service.name", value: { stringValue: options.serviceName } },
          {
            key: "deployment.environment",
            value: {
              stringValue:
                setting(env, "FG_STAGE") ??
                setting(env, "NODE_ENV") ??
                "production",
            },
          },
        ];
        const body = JSON.stringify({
          resourceSpans: [
            {
              resource: { attributes: resourceAttributes },
              scopeSpans: [
                {
                  scope: { name: "@gmacko/core/telemetry/worker" },
                  spans: [
                    {
                      traceId,
                      spanId,
                      parentSpanId: parent?.parentSpanId,
                      name: `${request.method} ${route}`,
                      kind: 2,
                      startTimeUnixNano: (BigInt(start) * 1000000n).toString(),
                      endTimeUnixNano: (BigInt(end) * 1000000n).toString(),
                      attributes,
                      status: { code: status >= 500 ? 2 : 0 },
                    },
                  ],
                },
              ],
            },
          ],
        });
        try {
          ctx.waitUntil(pushSpan(env, options, body));
        } catch {
          diagnostic("wait_until_unavailable");
        }
      }
    }
  };
}
