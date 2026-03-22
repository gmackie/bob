import type { StdioAdapter, ParsedEvent } from "./base-stdio-adapter.js";

export function createClaudeStdioAdapter(workingDirectory: string): StdioAdapter {
  return {
    command: "claude",
    args: ["--output-format", "stream-json", "--verbose", "-p"],
    env: {
      CLAUDE_WORKING_DIR: workingDirectory,
    },

    parseLine(line: string): ParsedEvent | null {
      const trimmed = line.trim();
      if (!trimmed) return null;

      try {
        const msg = JSON.parse(trimmed) as Record<string, unknown>;
        const type = msg.type as string;
        const subtype = msg.subtype as string | undefined;

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

        // Tool result
        if (type === "tool_result") {
          return {
            type: "tool_result",
            data: {
              toolCallId: msg.tool_use_id as string,
              result: JSON.stringify(msg.content ?? ""),
              isError: (msg.is_error as boolean) ?? false,
            },
          };
        }

        // Result — session complete
        if (type === "result") {
          const isError = msg.is_error as boolean;
          if (isError) {
            return {
              type: "error",
              data: { message: (msg.result as string) ?? "Agent error" },
            };
          }
          return { type: "status", data: { status: "completed" } };
        }

        // Content block delta (streaming chunks)
        if (type === "content_block_delta") {
          const delta = msg.delta as Record<string, unknown> | undefined;
          if (delta?.type === "text_delta" && typeof delta.text === "string") {
            return { type: "output", data: { text: delta.text } };
          }
        }

        // Content block start (tool_use)
        if (type === "content_block_start") {
          const block = msg.content_block as Record<string, unknown> | undefined;
          if (block?.type === "tool_use") {
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
      // Simple text input — Claude reads from stdin line by line in -p mode
      return message + "\n";
    },
  };
}
