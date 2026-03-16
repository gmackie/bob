import type { StdioAdapter, ParsedEvent } from "./base-stdio-adapter.js";

let nextId = 1;

export function createOpencodeStdioAdapter(workingDirectory: string): StdioAdapter {
  return {
    command: "opencode",
    args: ["serve", "--stdio"],
    env: {
      OPENCODE_WORKING_DIR: workingDirectory,
    },

    parseLine(line: string): ParsedEvent | null {
      const trimmed = line.trim();
      if (!trimmed) return null;

      try {
        const msg = JSON.parse(trimmed) as Record<string, unknown>;

        if (msg.jsonrpc !== "2.0") {
          return { type: "output", data: { text: trimmed } };
        }

        // JSON-RPC notification
        if (msg.method && !("id" in msg)) {
          const params = (msg.params as Record<string, unknown>) ?? {};
          switch (msg.method) {
            case "events/output":
              return { type: "output", data: { text: (params.text as string) ?? "" } };
            case "events/toolCall":
              return {
                type: "tool_call",
                data: {
                  toolCallId: params.id as string,
                  name: params.name as string,
                  arguments: JSON.stringify(params.arguments ?? {}),
                },
              };
            case "events/toolResult":
              return {
                type: "tool_result",
                data: {
                  toolCallId: params.id as string,
                  result: JSON.stringify(params.result ?? ""),
                  isError: (params.isError as boolean) ?? false,
                },
              };
            case "events/status":
              return { type: "status", data: { status: params.status as string } };
            case "events/error":
              return { type: "error", data: { message: (params.message as string) ?? "Unknown error" } };
            default:
              return { type: "output", data: { text: trimmed } };
          }
        }

        // JSON-RPC response
        if (msg.error) {
          const err = msg.error as Record<string, unknown>;
          return { type: "error", data: { message: (err.message as string) ?? "RPC error", code: err.code } };
        }

        if (msg.result !== undefined) {
          return { type: "status", data: { result: msg.result } };
        }

        return null;
      } catch {
        return { type: "output", data: { text: trimmed } };
      }
    },

    formatInput(message: string): string {
      const request = {
        jsonrpc: "2.0",
        id: nextId++,
        method: "chat/send",
        params: { message },
      };
      return JSON.stringify(request) + "\n";
    },
  };
}
