import type { AgentType } from "../types";
import { BaseAgentAdapter } from "./base-adapter";
import { extractUsageFields, isGenericUsagePayload } from "./usage-parsing";

export class GrokAdapter extends BaseAgentAdapter {
  readonly type: AgentType = "grok";
  readonly name = "Grok Build";
  readonly command = "grok";

  getSpawnArgs(options?: { interactive?: boolean }): { command: string; args: string[]; env?: Record<string, string> } {
    return {
      command: this.command,
      args: options?.interactive ? [] : ["--print", "--output-format", "streaming-json"],
      env: { TERM: "xterm-256color", COLORTERM: "truecolor" },
    };
  }

  async checkAuthentication(): Promise<{ isAuthenticated: boolean; authenticationStatus?: string; statusMessage?: string }> {
    try {
      const result = await this.runCommand(["models"], 5_000);
      return result.code === 0
        ? { isAuthenticated: true, authenticationStatus: "Authenticated" }
        : { isAuthenticated: false, authenticationStatus: "Not authenticated", statusMessage: "Run grok login --device-auth" };
    } catch {
      return { isAuthenticated: false, authenticationStatus: "Unknown", statusMessage: "Unable to verify Grok authentication" };
    }
  }

  parseOutput(output: string): { inputTokens?: number; outputTokens?: number; cost?: number } | null {
    for (const line of output.split("\n")) {
      try {
        const parsed: unknown = JSON.parse(line.trim());
        if (!isGenericUsagePayload(parsed)) continue;
        const usage = extractUsageFields(parsed);
        if (!usage) continue;
        return {
          inputTokens: usage.input_tokens ?? usage.prompt_tokens ?? 0,
          outputTokens: usage.output_tokens ?? usage.completion_tokens ?? 0,
          cost: usage.cost ?? 0,
        };
      } catch {
        // Streaming output may contain non-JSON progress lines.
      }
    }
    return null;
  }

  protected isAgentReady(data: string, fullOutput: string): boolean {
    return data.includes("Grok") || data.includes("grok") || fullOutput.length > 50;
  }
}
