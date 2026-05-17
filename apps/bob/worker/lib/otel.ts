/**
 * Standalone OTel instrumentation for CF Workers.
 * Copy this single file into any app — zero dependencies.
 *
 * Usage:
 *   import { wrapFetch } from "./otel";
 *   export default { fetch: wrapFetch(originalFetch) };
 */

type FetchHandler = (request: Request, env: Record<string, unknown>, ctx: ExecutionContext) => Promise<Response>;

interface InstrumentOptions {
  serviceName?: string;
  sampleRate?: number;
  endpoint?: string;
}

export function wrapFetch(handler: FetchHandler, options?: InstrumentOptions): FetchHandler {
  return async (request, env, ctx) => {
    const serviceName = options?.serviceName ?? (env.FG_APP as string) ?? "unknown";
    const endpoint = options?.endpoint ?? (env.OTEL_ENDPOINT as string) ?? "https://otlp.forgegraf.com";
    const disabled = (env.OTEL_DISABLED as string) === "true";
    const sampleRate = options?.sampleRate ?? 1.0;

    if (disabled || (sampleRate < 1.0 && Math.random() >= sampleRate)) {
      return handler(request, env, ctx);
    }

    const start = Date.now();
    let response: Response;
    let error: unknown;

    try {
      response = await handler(request, env, ctx);
    } catch (err) {
      error = err;
      response = new Response("Internal Server Error", { status: 500 });
    }

    const latencyMs = Date.now() - start;
    const url = new URL(request.url);

    ctx.waitUntil(
      pushSpan({
        endpoint,
        serviceName,
        stage: env.FG_STAGE as string,
        method: request.method,
        path: url.pathname,
        status: response.status,
        latencyMs,
        error: error ? String(error) : undefined,
      }).catch(() => {}),
    );

    if (error) throw error;
    return response;
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
  error?: string;
}) {
  const traceId = hex(16);
  const spanId = hex(8);
  const now = BigInt(Date.now()) * 1000000n;
  const startTime = (now - BigInt(opts.latencyMs) * 1000000n).toString();
  const endTime = now.toString();

  const attributes = [
    { key: "http.method", value: { stringValue: opts.method } },
    { key: "http.target", value: { stringValue: opts.path } },
    { key: "http.status_code", value: { intValue: String(opts.status) } },
    { key: "http.latency_ms", value: { intValue: String(opts.latencyMs) } },
  ];
  if (opts.stage) attributes.push({ key: "deployment.environment", value: { stringValue: opts.stage } });
  if (opts.error) attributes.push({ key: "exception.message", value: { stringValue: opts.error } });

  const resourceAttrs = [
    { key: "service.name", value: { stringValue: opts.serviceName } },
  ];
  if (opts.stage) resourceAttrs.push({ key: "deployment.environment", value: { stringValue: opts.stage } });

  const payload = {
    resourceSpans: [{
      resource: { attributes: resourceAttrs },
      scopeSpans: [{
        scope: { name: "@forgegraph/otel" },
        spans: [{
          traceId,
          spanId,
          name: `${opts.method} ${opts.path}`,
          kind: 2,
          startTimeUnixNano: startTime,
          endTimeUnixNano: endTime,
          attributes,
          status: { code: opts.status >= 500 ? 2 : 1 },
        }],
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
