import { createClaudeStdioAdapter } from "./claude-stdio.js";
import { createCodexStdioAdapter } from "./codex-stdio.js";
import { createOpencodeStdioAdapter } from "./opencode-stdio.js";
import { createSmolAgentAcpAdapter } from "./smol-agent-acp.js";

export interface ParsedEvent {
  type: "output" | "tool_call" | "tool_result" | "status" | "error";
  data: Record<string, unknown>;
}

export interface StdioAdapter {
  command: string;
  args: string[];
  env?: Record<string, string>;
  parseLine(line: string): ParsedEvent | null;
  formatInput(message: string): string;
}

export function getStdioAdapter(
  agentType: string,
  workingDirectory: string,
  runtimeEnv: Record<string, string> = {},
): StdioAdapter | null {
  switch (agentType) {
    case "claude":
      return createClaudeStdioAdapter(workingDirectory);
    case "codex":
      return createCodexStdioAdapter(workingDirectory);
    case "opencode":
      return createOpencodeStdioAdapter(workingDirectory);
    case "smol-agent":
      return createSmolAgentAcpAdapter(workingDirectory, runtimeEnv);
    default:
      return null;
  }
}
