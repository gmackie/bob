import type { StdioAdapter, ParsedEvent } from "./base-stdio-adapter.js";

export function createClaudeStdioAdapter(workingDirectory: string): StdioAdapter {
  return {
    // Interactive conversation mode — Claude stays alive and reads stdin continuously
    command: "claude",
    args: [],
    env: {
      CLAUDE_WORKING_DIR: workingDirectory,
    },

    parseLine(line: string): ParsedEvent | null {
      const trimmed = line.trim();
      if (!trimmed) return null;

      // In interactive mode, Claude outputs plain text (not JSON)
      // Each line of output is treated as agent response text
      return { type: "output", data: { text: trimmed + "\n" } };
    },

    formatInput(message: string): string {
      // Send message as plain text followed by newline
      return message + "\n";
    },
  };
}
