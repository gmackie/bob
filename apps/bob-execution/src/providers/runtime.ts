import { providerIds } from "./contract.js";
import type { ProviderId, ProviderUsageValue } from "./contract.js";

export interface ProviderCommandOptions {
  model?: string;
  sandbox?: string;
  allowedTools?: string[];
  systemPrompt?: string;
}

export function isProviderId(value: string): value is ProviderId {
  return providerIds.some((provider) => provider === value);
}

export function normalizeProviderId(value: string): ProviderId | null {
  if (value === "cursor") return "cursor-agent";
  return isProviderId(value) ? value : null;
}

export function buildProviderEnvironment(
  provider: ProviderId | null,
  env: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  const childEnv = { ...env };
  if (provider === "claude") delete childEnv.ANTHROPIC_API_KEY;
  return childEnv;
}

export function buildProviderCommand(
  provider: ProviderId,
  prompt: string,
  options: ProviderCommandOptions = {},
): { command: string; args: string[] } {
  if (provider === "claude") {
    const args = ["--output-format", "stream-json", "--verbose", "--dangerously-skip-permissions"];
    if (options.model) args.push("--model", options.model);
    if (options.allowedTools?.length) args.push("--allowedTools", options.allowedTools.join(","));
    if (options.systemPrompt) args.push("--append-system-prompt", options.systemPrompt);
    return { command: "claude", args: [...args, "-p", prompt] };
  }
  if (provider === "codex") {
    const args = ["exec", "--json"];
    if (options.sandbox === "bypass") args.push("--dangerously-bypass-approvals-and-sandbox");
    else args.push("-s", options.sandbox ?? "workspace-write");
    if (options.model) args.push("-m", options.model);
    return { command: "codex", args: [...args, prompt] };
  }
  if (provider === "grok") {
    const args = ["--single", prompt, "--output-format", "streaming-json", "--permission-mode", "bypassPermissions"];
    if (options.model) args.push("--model", options.model);
    return { command: "grok", args };
  }
  const args = ["--print", "--output-format", "stream-json", "--trust", "--force"];
  if (options.model) args.push("--model", options.model);
  return { command: "cursor-agent", args: [...args, prompt] };
}

function tokenNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

export function parseProviderStream(
  provider: ProviderId,
  output: string,
  prompt = "",
): { nativeSessionId?: string; usage?: ProviderUsageValue } {
  let nativeSessionId: string | undefined;
  let usage: ProviderUsageValue | undefined;
  let streamedText = "";
  for (const line of output.split("\n")) {
    try {
      const value: unknown = JSON.parse(line.trim());
      if (!value || typeof value !== "object") continue;
      const record = value as Record<string, unknown>;
      const sessionId = record.session_id ?? record.thread_id ?? record.chat_id;
      if (typeof sessionId === "string") nativeSessionId = sessionId;
      if (provider === "grok" && record.type === "text" && typeof record.data === "string") {
        streamedText += record.data;
      }
      if (record.usage && typeof record.usage === "object") {
        const tokens = record.usage as Record<string, unknown>;
        usage = {
          source: "provider",
          inputTokens: tokenNumber(tokens.input_tokens ?? tokens.inputTokens ?? tokens.prompt_tokens),
          outputTokens: tokenNumber(tokens.output_tokens ?? tokens.outputTokens ?? tokens.completion_tokens),
          costUsd: typeof tokens.cost === "number" ? tokens.cost : undefined,
        };
      }
    } catch {
      // Ignore provider progress lines that are not JSON.
    }
  }
  if (!usage && provider === "grok" && (prompt.length > 0 || streamedText.length > 0)) {
    usage = {
      source: "estimated",
      inputTokens: Math.ceil(prompt.length / 4),
      outputTokens: Math.ceil(streamedText.length / 4),
    };
  }
  return { nativeSessionId, usage };
}

export class ProviderRunController {
  private cancelled = false;

  constructor(private readonly onCancel: () => void) {}

  cancel(): boolean {
    if (this.cancelled) return false;
    this.cancelled = true;
    this.onCancel();
    return true;
  }
}
