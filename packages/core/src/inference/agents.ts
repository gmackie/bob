import type { ChatMessage, ChatCompletionRequest } from "./types";

export const AGENT_PROVIDERS = ["claude", "codex", "cursor", "grok"] as const;
export type AgentProvider = (typeof AGENT_PROVIDERS)[number];

/** Map OpenAI-style provider prefixes to ooda-runner adapter ids. */
const AGENT_ROUTE: Record<
  string,
  { provider: AgentProvider; adapterId: string }
> = {
  claude: { provider: "claude", adapterId: "claude" },
  anthropic: { provider: "claude", adapterId: "claude" },
  codex: { provider: "codex", adapterId: "codex" },
  openai: { provider: "codex", adapterId: "codex" },
  cursor: { provider: "cursor", adapterId: "cursor-agent" },
  "cursor-agent": { provider: "cursor", adapterId: "cursor-agent" },
  grok: { provider: "grok", adapterId: "grok" },
  xai: { provider: "grok", adapterId: "grok" },
};

export type AgentRoute = {
  provider: AgentProvider;
  adapterId: string;
  model: string;
  rawModel: string;
};

export function resolveAgentRoute(rawModel: string): AgentRoute | null {
  const trimmed = rawModel.trim();
  if (!trimmed) return null;

  const slash = trimmed.indexOf("/");
  if (slash <= 0) return null;

  const api = trimmed.slice(0, slash);
  const model = trimmed.slice(slash + 1);
  if (!model) return null;

  const route = AGENT_ROUTE[api];
  if (!route) return null;

  return {
    provider: route.provider,
    adapterId: route.adapterId,
    model,
    rawModel: trimmed,
  };
}

export function formatMessagesForAgent(
  messages: ChatMessage[],
  req: Pick<ChatCompletionRequest, "response_format">,
): { prompt: string; systemPrompt?: string } {
  let system = messages
    .filter((m) => m.role === "system")
    .map((m) => m.content)
    .join("\n");

  if (req.response_format?.type === "json_object") {
    system = system
      ? `${system}\nRespond with JSON only.`
      : "Respond with JSON only.";
  }

  const convo = messages.filter((m) => m.role !== "system");
  const prompt =
    convo.length > 0
      ? convo.map((m) => `${m.role}: ${m.content}`).join("\n\n")
      : (messages.at(-1)?.content ?? "");

  return {
    prompt,
    ...(system ? { systemPrompt: system } : {}),
  };
}

export const DEFAULT_CODEX_MODEL = "5.6-luna";

export function resolveAgentModel(
  route: AgentRoute,
  env: Record<string, string | undefined> = process.env,
): string | undefined {
  switch (route.adapterId) {
    case "codex": {
      const api = route.rawModel.split("/")[0];
      if (api === "codex") return route.model;
      return env.CODEX_MODEL?.trim() || DEFAULT_CODEX_MODEL;
    }
    case "claude":
      return route.model;
    case "cursor-agent":
      return route.model === "default" ? undefined : route.model;
    case "grok":
      return route.model;
    default:
      return route.model;
  }
}

export const AGENT_MODELS: readonly { id: string; owned_by: AgentProvider }[] =
  [
    { id: "claude/claude-sonnet-4-5", owned_by: "claude" },
    { id: "claude/claude-opus-4-6", owned_by: "claude" },
    { id: "anthropic/claude-sonnet-4-5", owned_by: "claude" },
    { id: "codex/5.6-luna", owned_by: "codex" },
    { id: "openai/5.6-luna", owned_by: "codex" },
    { id: "cursor/default", owned_by: "cursor" },
    { id: "cursor-agent/default", owned_by: "cursor" },
    { id: "grok/grok-3", owned_by: "grok" },
    { id: "xai/grok-3", owned_by: "grok" },
  ];
