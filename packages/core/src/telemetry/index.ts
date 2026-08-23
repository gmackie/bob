/**
 * Shared OpenTelemetry spans for work both products do.
 *
 * Distinct from `@gmacko/core/monitoring`, which is the Effect-based
 * Logger/Metrics/Tracing abstraction still stubbed from Phase 6L. This module
 * is the concrete OTel instrumentation: real tracer, real spans, no Effect
 * runtime.
 *
 * Why it lives here rather than in `@bob/telemetry`: embedding spans are
 * emitted by OODA's oracle, and `packages/ooda` must not import `@bob/*` —
 * see docs/architecture/product-boundary.md. Telemetry is infrastructure, not
 * a Bob domain noun, so the shared home is core. `@bob/telemetry` re-exports
 * from here so there is exactly one definition.
 */
import { trace, SpanStatusCode } from "@opentelemetry/api";

/**
 * GenAI semantic convention attribute keys.
 * See: https://opentelemetry.io/docs/specs/semconv/gen-ai/
 */
export const GenAIAttributes = {
  SYSTEM: "gen_ai.system",
  REQUEST_MODEL: "gen_ai.request.model",
} as const;

/**
 * Embedding attribute keys.
 *
 * The `bob.` prefix is legacy and deliberately preserved: these exact strings
 * are already indexed by existing traces and dashboards, so renaming them to a
 * neutral namespace would silently orphan that history. The prefix describes
 * where the convention was born, not which product may emit it.
 */
export const EmbeddingAttributes = {
  MODEL: "bob.embedding.model",
  DIMENSIONS: "bob.embedding.dimensions",
  INPUT_COUNT: "bob.embedding.input_count",
} as const;

export interface EmbeddingContext {
  model: string;
  inputCount: number;
  dimensions?: number;
}

const tracer = trace.getTracer("@gmacko/core/telemetry");

/** Wraps an embedding API call with an OpenTelemetry span. */
export async function traceEmbedding<T>(
  ctx: EmbeddingContext,
  fn: () => Promise<T>,
): Promise<T> {
  return tracer.startActiveSpan(`embedding ${ctx.model}`, async (span) => {
    span.setAttribute(GenAIAttributes.SYSTEM, "openai");
    span.setAttribute(GenAIAttributes.REQUEST_MODEL, ctx.model);
    span.setAttribute(EmbeddingAttributes.MODEL, ctx.model);
    span.setAttribute(EmbeddingAttributes.INPUT_COUNT, ctx.inputCount);
    if (ctx.dimensions) {
      span.setAttribute(EmbeddingAttributes.DIMENSIONS, ctx.dimensions);
    }

    try {
      const result = await fn();
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (err) {
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: err instanceof Error ? err.message : String(err),
      });
      span.recordException(err instanceof Error ? err : new Error(String(err)));
      throw err;
    } finally {
      span.end();
    }
  });
}
