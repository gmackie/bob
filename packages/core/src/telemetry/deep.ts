/** Shared server tracing. Uses the Node SDK when installed, or a request-local Worker sink. */
import { AsyncLocalStorage } from "node:async_hooks";
import {
  context,
  trace,
  propagation,
  ROOT_CONTEXT,
  SpanKind,
  SpanStatusCode,
  isSpanContextValid,
  type Attributes,
} from "@opentelemetry/api";

export interface TraceCarrier {
  traceparent: string;
  tracestate?: string;
}
export interface TraceReference {
  traceId: string;
  spanId: string;
  sampled: boolean;
}
export interface TraceSpanOptions {
  carrier?: TraceCarrier;
  kind?: "internal" | "client" | "producer" | "consumer";
  attributes?: Record<string, string | number | boolean>;
  /** Delayed work starts a new trace linked to its producing span. */
  link?: boolean;
}
export interface WorkerSpan {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  name: string;
  kind: number;
  startTimeUnixNano: string;
  endTimeUnixNano: string;
  attributes: {
    key: string;
    value: {
      stringValue?: string;
      intValue?: string;
      doubleValue?: number;
      boolValue?: boolean;
    };
  }[];
  status: { code: number };
  links?: { traceId: string; spanId: string }[];
}
interface WorkerContext extends TraceReference {
  tracestate?: string;
  emit: (span: WorkerSpan) => void;
  budget: { remaining: number };
  status?: { code: number };
  attributes?: Attributes;
}
const workerContext = new AsyncLocalStorage<WorkerContext>();
const kinds = {
  internal: SpanKind.INTERNAL,
  client: SpanKind.CLIENT,
  producer: SpanKind.PRODUCER,
  consumer: SpanKind.CONSUMER,
};
const safeKeys = new Set([
  "db.system.name",
  "db.operation.name",
  "workspace.id",
  "work_item.id",
  "task_run.id",
  "attempt.id",
  "job.id",
  "execution.id",
  "session.id",
  "issue.id",
  "forgegraph.work_item.id",
  "retry.count",
  "queue.wait_ms",
  "messaging.operation",
  "messaging.destination.name",
  "outcome",
  "peer.service",
  "http.request.method",
  "http.response.status_code",
  "error.type",
]);
function attributes(input: TraceSpanOptions["attributes"]): Attributes {
  return Object.fromEntries(
    Object.entries(input ?? {}).filter(
      ([k, v]) =>
        safeKeys.has(k) &&
        (typeof v === "boolean" ||
          (typeof v === "number" && Number.isFinite(v)) ||
          (typeof v === "string" && /^[a-zA-Z0-9_.:/-]{1,128}$/.test(v))),
    ),
  );
}
export function validateTraceCarrier(input: unknown): TraceCarrier | undefined {
  if (!input || typeof input !== "object") return undefined;
  const { traceparent } = input as Record<string, unknown>;
  if (
    typeof traceparent !== "string" ||
    !/^00-[0-9a-f]{32}-[0-9a-f]{16}-[0-9a-f]{2}$/.test(traceparent)
  )
    return undefined;
  const [, t, s] = traceparent.split("-");
  if (/^0+$/.test(t!) || /^0+$/.test(s!)) return undefined;
  // No vendor tracestate keys are currently approved for propagation.
  return { traceparent };
}
function reference(carrier: TraceCarrier): TraceReference {
  const [, traceId, spanId, flags] = carrier.traceparent.split("-");
  return {
    traceId: traceId!,
    spanId: spanId!,
    sampled: (parseInt(flags!, 16) & 1) === 1,
  };
}
export function getTraceReference(): TraceReference | undefined {
  const local = workerContext.getStore();
  if (local)
    return {
      traceId: local.traceId,
      spanId: local.spanId,
      sampled: local.sampled,
    };
  const sc = trace.getSpanContext(context.active());
  return sc && isSpanContextValid(sc)
    ? {
        traceId: sc.traceId,
        spanId: sc.spanId,
        sampled: (sc.traceFlags & 1) === 1,
      }
    : undefined;
}
export function captureTraceCarrier(): TraceCarrier | undefined {
  const local = workerContext.getStore();
  if (local)
    return {
      traceparent: `00-${local.traceId}-${local.spanId}-${local.sampled ? "01" : "00"}`,
      ...(local.tracestate ? { tracestate: local.tracestate } : {}),
    };
  const carrier: Record<string, string> = {};
  propagation.inject(context.active(), carrier);
  return validateTraceCarrier(carrier);
}
export function runWithWorkerTrace<T>(
  ref: TraceReference,
  carrier: TraceCarrier | undefined,
  emit: (span: WorkerSpan) => void,
  fn: () => T,
): T {
  return workerContext.run(
    {
      ...ref,
      tracestate: validateTraceCarrier(carrier)?.tracestate,
      emit,
      budget: { remaining: 128 },
    },
    fn,
  );
}
function id(bytes: number) {
  return Array.from(crypto.getRandomValues(new Uint8Array(bytes)), (n) =>
    n.toString(16).padStart(2, "0"),
  ).join("");
}
const nano = () => (BigInt(Date.now()) * 1_000_000n).toString();
export async function withTraceSpan<T>(
  name: string,
  fn: () => Promise<T>,
  options: TraceSpanOptions = {},
): Promise<T> {
  // Callers supply static operation names. Never make task titles or URLs span names.
  const operation = /^[a-zA-Z][a-zA-Z0-9_. -]{0,95}$/.test(name)
    ? name
    : "operation";
  const carrier = validateTraceCarrier(options.carrier),
    linked = carrier && options.link ? reference(carrier) : undefined;
  const local = workerContext.getStore(),
    attrs = attributes(options.attributes);
  if (local) {
    const remote = carrier ? reference(carrier) : undefined;
    const parent = remote ?? local;
    // Keep the nearest emitted parent when no child span can be recorded.
    if (parent.sampled && local.budget.remaining <= 0) return fn();
    const child: WorkerContext = {
      ...local,
      status: { code: 0 },
      attributes: attrs,
      traceId: linked ? id(16) : parent.traceId,
      spanId: id(8),
      sampled: parent.sampled,
      tracestate: carrier?.tracestate ?? local.tracestate,
    };
    const start = nano();
    let failed = false;
    // One request cannot accumulate an unbounded number of operation spans.
    const recording = child.sampled && local.budget.remaining-- > 0;
    try {
      return await workerContext.run(child, fn);
    } catch (error) {
      failed = true;
      throw error;
    } finally {
      if (recording) {
        try {
          local.emit({
            traceId: child.traceId,
            spanId: child.spanId,
            ...(!linked ? { parentSpanId: parent.spanId } : {}),
            name: operation,
            kind: kinds[options.kind ?? "internal"] + 1,
            startTimeUnixNano: start,
            endTimeUnixNano: nano(),
            attributes: Object.entries(child.attributes ?? attrs).map(
              ([key, v]) => ({
                key,
                value:
                  typeof v === "number"
                    ? { doubleValue: v }
                    : typeof v === "boolean"
                      ? { boolValue: v }
                      : { stringValue: String(v) },
              }),
            ),
            status: { code: failed ? 2 : (child.status?.code ?? 0) },
            ...(linked
              ? { links: [{ traceId: linked.traceId, spanId: linked.spanId }] }
              : {}),
          });
        } catch {
          /* Telemetry cannot change the operation outcome. */
        }
      }
    }
  }
  const extracted = carrier
    ? propagation.extract(ROOT_CONTEXT, carrier)
    : context.active();
  const linkedContext = linked ? trace.getSpanContext(extracted) : undefined;
  // Preserve upstream non-sampling even when starting a linked attempt.
  if (linked && !linked.sampled)
    return context.with(
      trace.setSpanContext(ROOT_CONTEXT, {
        traceId: id(16),
        spanId: id(8),
        traceFlags: 0,
      }),
      fn,
    );
  return trace
    .getTracer("@gmacko/core/deep")
    .startActiveSpan(
      operation,
      {
        kind: kinds[options.kind ?? "internal"],
        attributes: attrs,
        ...(linkedContext ? { links: [{ context: linkedContext }] } : {}),
      },
      linked ? ROOT_CONTEXT : extracted,
      async (span) => {
        try {
          return await fn();
        } catch (error) {
          span.setStatus({ code: SpanStatusCode.ERROR });
          span.setAttribute("error.type", "operation_failed");
          throw error;
        } finally {
          span.end();
        }
      },
    );
}
export interface TracedFetchOptions {
  service: "forgegraph" | "kanbanger" | "bob" | "ooda";
  baseUrl: string;
  fetch?: typeof fetch;
}
/** Transport is explicitly scoped; does not patch global fetch or send baggage. */
export async function tracedFetch(
  input: Parameters<typeof globalThis.fetch>[0],
  init: RequestInit | undefined,
  options: TracedFetchOptions,
): Promise<Response> {
  const transport = options.fetch ?? globalThis.fetch;
  let target: URL, base: URL;
  try {
    target = new URL(input instanceof Request ? input.url : String(input));
    base = new URL(options.baseUrl);
  } catch {
    return transport(input, init);
  }
  if (target.origin !== base.origin || target.username || target.password)
    return transport(input, init);
  return withTraceSpan(
    `${options.service}.http`,
    async () => {
      const headers = new Headers(
        input instanceof Request ? input.headers : undefined,
      );
      new Headers(init?.headers).forEach((v, k) => headers.set(k, v));
      headers.delete("baggage");
    headers.delete("tracestate");
    const carrier = captureTraceCarrier();
      if (carrier) {
        headers.set("traceparent", carrier.traceparent);
        if (carrier.tracestate) headers.set("tracestate", carrier.tracestate);
        else headers.delete("tracestate");
      }
      const response = await transport(input, {
        ...init,
        headers,
        redirect: "manual",
      });
      const current = workerContext.getStore();
      if (current?.attributes)
        current.attributes["http.response.status_code"] = response.status;
      const span = trace.getSpan(context.active());
      span?.setAttribute("http.response.status_code", response.status);
      if (response.status >= 500) {
        if (current?.status) current.status.code = 2;
        span?.setStatus({ code: SpanStatusCode.ERROR });
      }
      return response;
    },
    {
      kind: "client",
      attributes: {
        "peer.service": options.service,
        "http.request.method":
          init?.method ?? (input instanceof Request ? input.method : "GET"),
      },
    },
  );
}

/** Only server configuration may supply this base; trace IDs grant no authorization. */
export function buildTraceViewerUrl(
  traceId: string,
  trustedBase: string,
): string | undefined {
  if (!/^[0-9a-f]{32}$/.test(traceId) || /^0+$/.test(traceId)) return undefined;
  try {
    const base = new URL(trustedBase);
    if (
      base.protocol !== "https:" ||
      base.username ||
      base.password ||
      base.search ||
      base.hash
    )
      return undefined;
    base.pathname = base.pathname.replace(/\/+$/, "") + "/trace/" + traceId;
    return base.toString();
  } catch {
    return undefined;
  }
}
