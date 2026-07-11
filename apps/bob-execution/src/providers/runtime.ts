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
    return { command: "claude", args: [...args, prompt] };
  }
  if (provider === "codex") {
    const args = ["exec", "--json"];
    if (options.sandbox === "bypass") args.push("--dangerously-bypass-approvals-and-sandbox");
    else args.push("-s", options.sandbox ?? "workspace-write");
    if (options.model) args.push("-m", options.model);
    return { command: "codex", args: [...args, prompt] };
  }
  if (provider === "grok") {
    const args = ["--print", "--output-format", "streaming-json"];
    if (options.model) args.push("--model", options.model);
    return { command: "grok", args: [...args, prompt] };
  }
  const args = ["--print", "--output-format", "stream-json"];
  if (options.model) args.push("--model", options.model);
  return { command: "cursor-agent", args: [...args, prompt] };
}

function tokenNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

export function parseProviderStream(
  _provider: ProviderId,
  output: string,
): { nativeSessionId?: string; usage?: ProviderUsageValue } {
  let nativeSessionId: string | undefined;
  let usage: ProviderUsageValue | undefined;
  for (const line of output.split("\n")) {
    try {
      const value: unknown = JSON.parse(line.trim());
      if (!value || typeof value !== "object") continue;
      const record = value as Record<string, unknown>;
      const sessionId = record.session_id ?? record.thread_id ?? record.chat_id;
      if (typeof sessionId === "string") nativeSessionId = sessionId;
      if (record.usage && typeof record.usage === "object") {
        const tokens = record.usage as Record<string, unknown>;
        usage = {
          source: "provider",
          inputTokens: tokenNumber(tokens.input_tokens ?? tokens.prompt_tokens),
          outputTokens: tokenNumber(tokens.output_tokens ?? tokens.completion_tokens),
          costUsd: typeof tokens.cost === "number" ? tokens.cost : undefined,
        };
      }
    } catch {
      // Ignore provider progress lines that are not JSON.
    }
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
