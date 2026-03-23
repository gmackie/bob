import type { StdioAdapter, ParsedEvent } from "./base-stdio-adapter.js";

export function createClaudeStdioAdapter(workingDirectory: string): StdioAdapter {
  return {
    // Sentinel process — just keeps the session "managed" in the process manager
    // Actual messages spawn per-message Claude -p processes (see agent-process-manager.ts)
    command: "true",  // /usr/bin/true — exits immediately with code 0, no output
    args: [],
    env: {
      CLAUDE_WORKING_DIR: workingDirectory,
    },

    parseLine(line: string): ParsedEvent | null {
      const trimmed = line.trim();
      if (!trimmed) return null;

      try {
        const msg = JSON.parse(trimmed) as Record<string, unknown>;
        const type = msg.type as string;

        // Skip system events (hooks, init, rate limits)
        if (type === "system" || type === "rate_limit_event") {
          return null;
        }

        // Assistant response — extract text from message.content
        if (type === "assistant") {
          const message = msg.message as Record<string, unknown> | undefined;
          if (!message) return null;

          const content = message.content as Array<Record<string, unknown>> | undefined;
          if (!content || !Array.isArray(content)) return null;

          const textParts: string[] = [];
          for (const block of content) {
            if (block.type === "text" && typeof block.text === "string") {
              textParts.push(block.text);
            }
            if (block.type === "tool_use") {
              return {
                type: "tool_call",
                data: {
                  toolCallId: block.id as string,
                  name: block.name as string,
                  arguments: JSON.stringify(block.input ?? {}),
                },
              };
            }
          }

          if (textParts.length > 0) {
            return { type: "output", data: { text: textParts.join("") } };
          }
          return null;
        }

        // Result — session complete for this message
        if (type === "result") {
          const resultText = msg.result as string | undefined;
          if (resultText && resultText.length > 0) {
            return { type: "output", data: { text: resultText } };
          }
          return { type: "status", data: { status: "completed" } };
        }

        // Error
        if (type === "error") {
          return {
            type: "error",
            data: { message: (msg.error as Record<string, unknown>)?.message ?? "Unknown error" },
          };
        }

        return null;
      } catch {
        // Not JSON — treat as raw text output
        return { type: "output", data: { text: trimmed } };
      }
    },

    formatInput(message: string): string {
      return message + "\n";
    },
  };
}
