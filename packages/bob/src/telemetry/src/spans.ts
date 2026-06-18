import { trace, SpanStatusCode, type Span } from "@opentelemetry/api";
import { GenAIAttributes, BobAttributes } from "./attributes.js";

const tracer = trace.getTracer("@bob/telemetry");

export interface AgentExecutionContext {
  agentType: string;
  sessionId: string;
  taskIdentifier?: string;
  taskTitle?: string;
  workspaceId?: string;
  branch?: string;
}

export interface AgentExecutionResult {
  exitCode: number;
  inputTokens?: number;
  outputTokens?: number;
  costUsd?: number;
}

/**
 * Wraps an agent CLI execution with an OpenTelemetry span.
 * Call `setResult()` on completion to record token usage and cost.
 */
export async function traceAgentExecution<T>(
  ctx: AgentExecutionContext,
  fn: (span: Span) => Promise<T>,
): Promise<T> {
  return tracer.startActiveSpan(`agent.execute ${ctx.agentType}`, async (span) => {
    span.setAttribute(GenAIAttributes.SYSTEM, ctx.agentType);
    span.setAttribute(GenAIAttributes.REQUEST_MODEL, ctx.agentType);
    span.setAttribute(BobAttributes.AGENT_TYPE, ctx.agentType);
    span.setAttribute(BobAttributes.SESSION_ID, ctx.sessionId);

    if (ctx.taskIdentifier) span.setAttribute(BobAttributes.TASK_IDENTIFIER, ctx.taskIdentifier);
    if (ctx.taskTitle) span.setAttribute(BobAttributes.TASK_TITLE, ctx.taskTitle);
    if (ctx.workspaceId) span.setAttribute(BobAttributes.WORKSPACE_ID, ctx.workspaceId);
    if (ctx.branch) span.setAttribute(BobAttributes.BRANCH, ctx.branch);

    try {
      const result = await fn(span);
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

/** Record token usage and cost on an active agent execution span. */
export function setAgentResult(span: Span, result: AgentExecutionResult): void {
  span.setAttribute(BobAttributes.AGENT_EXIT_CODE, result.exitCode);
  if (result.inputTokens !== undefined) {
    span.setAttribute(GenAIAttributes.USAGE_INPUT_TOKENS, result.inputTokens);
  }
  if (result.outputTokens !== undefined) {
    span.setAttribute(GenAIAttributes.USAGE_OUTPUT_TOKENS, result.outputTokens);
  }
  if (result.inputTokens !== undefined && result.outputTokens !== undefined) {
    span.setAttribute(GenAIAttributes.USAGE_TOTAL_TOKENS, result.inputTokens + result.outputTokens);
  }
  if (result.costUsd !== undefined) {
    span.setAttribute(BobAttributes.AGENT_COST_USD, result.costUsd);
  }
}

export interface EmbeddingContext {
  model: string;
  inputCount: number;
  dimensions?: number;
}

/** Wraps an embedding API call with an OpenTelemetry span. */
export async function traceEmbedding<T>(
  ctx: EmbeddingContext,
  fn: () => Promise<T>,
): Promise<T> {
  return tracer.startActiveSpan(`embedding ${ctx.model}`, async (span) => {
    span.setAttribute(GenAIAttributes.SYSTEM, "openai");
    span.setAttribute(GenAIAttributes.REQUEST_MODEL, ctx.model);
    span.setAttribute(BobAttributes.EMBEDDING_MODEL, ctx.model);
    span.setAttribute(BobAttributes.EMBEDDING_INPUT_COUNT, ctx.inputCount);
    if (ctx.dimensions) span.setAttribute(BobAttributes.EMBEDDING_DIMENSIONS, ctx.dimensions);

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

/** Wraps webhook processing with an OpenTelemetry span. */
export async function traceWebhook<T>(
  provider: string,
  eventType: string,
  fn: () => Promise<T>,
): Promise<T> {
  return tracer.startActiveSpan(`webhook.process ${provider}`, async (span) => {
    span.setAttribute(BobAttributes.WEBHOOK_PROVIDER, provider);
    span.setAttribute(BobAttributes.WEBHOOK_EVENT_TYPE, eventType);

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
