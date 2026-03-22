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

        // Claude stream-json emits objects with a "type" field
        if (msg.type === "assistant" || msg.type === "text" || msg.type === "content_block_delta") {
          const text =
            (msg.text as string | undefined) ??
            ((msg.delta as Record<string, unknown> | undefined)?.text as string | undefined) ??
            "";
          return { type: "output", data: { text } };
        }

        if (msg.type === "tool_use" || msg.type === "content_block_start") {
          const block = (msg.content_block as Record<string, unknown> | undefined) ?? msg;
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

        if (msg.type === "tool_result") {
          return {
            type: "tool_result",
            data: {
              toolCallId: msg.tool_use_id as string,
              result: JSON.stringify(msg.content ?? ""),
              isError: (msg.is_error as boolean) ?? false,
            },
          };
        }

        if (msg.type === "error") {
          return {
            type: "error",
            data: { message: (msg.error as Record<string, unknown>)?.message ?? "Unknown error" },
          };
        }

        if (msg.type === "message_stop" || msg.type === "result") {
          return { type: "status", data: { status: "completed" } };
        }

        // Fallback: treat as output if there's any text content
        if (typeof msg.text === "string") {
          return { type: "output", data: { text: msg.text } };
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
