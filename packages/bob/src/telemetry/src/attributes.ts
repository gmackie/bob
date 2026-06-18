/**
 * GenAI semantic convention attribute keys for LLM observability.
 * See: https://opentelemetry.io/docs/specs/semconv/gen-ai/
 */

export const GenAIAttributes = {
  SYSTEM: "gen_ai.system",
  REQUEST_MODEL: "gen_ai.request.model",
  RESPONSE_MODEL: "gen_ai.response.model",
  USAGE_INPUT_TOKENS: "gen_ai.usage.input_tokens",
  USAGE_OUTPUT_TOKENS: "gen_ai.usage.output_tokens",
  USAGE_TOTAL_TOKENS: "gen_ai.usage.total_tokens",
} as const;

export const BobAttributes = {
  TASK_ID: "bob.task.id",
  TASK_IDENTIFIER: "bob.task.identifier",
  TASK_TITLE: "bob.task.title",
  SESSION_ID: "bob.session.id",
  WORKSPACE_ID: "bob.workspace.id",
  AGENT_TYPE: "bob.agent.type",
  AGENT_EXIT_CODE: "bob.agent.exit_code",
  AGENT_COST_USD: "bob.agent.cost_usd",
  BRANCH: "bob.branch",
  WEBHOOK_PROVIDER: "bob.webhook.provider",
  WEBHOOK_EVENT_TYPE: "bob.webhook.event_type",
  EMBEDDING_MODEL: "bob.embedding.model",
  EMBEDDING_DIMENSIONS: "bob.embedding.dimensions",
  EMBEDDING_INPUT_COUNT: "bob.embedding.input_count",
} as const;
