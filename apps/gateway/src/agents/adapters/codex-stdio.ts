import type { StdioAdapter, ParsedEvent } from "./base-stdio-adapter.js";

let nextId = 1;

export function createCodexStdioAdapter(workingDirectory: string): StdioAdapter {
  let initialized = false;
  let threadStarted = false;

  return {
    command: "codex",
    args: ["app-server"],
    env: {
      CODEX_WORKING_DIR: workingDirectory,
    },

    parseLine(line: string): ParsedEvent | null {
      const trimmed = line.trim();
      if (!trimmed) return null;

      try {
        const msg = JSON.parse(trimmed) as Record<string, unknown>;

        // JSON-RPC response or notification
        if (msg.jsonrpc !== "2.0") {
          return { type: "output", data: { text: trimmed } };
        }

        // JSON-RPC notification (no id)
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

        // JSON-RPC response (has id, has result or error)
        if (msg.error) {
          const err = msg.error as Record<string, unknown>;
          return { type: "error", data: { message: (err.message as string) ?? "RPC error", code: err.code } };
        }

        // Track initialization and thread start responses
        if (msg.result !== undefined) {
          if (!initialized) {
            initialized = true;
          } else if (!threadStarted) {
            threadStarted = true;
          }
          return { type: "status", data: { result: msg.result } };
        }

        return null;
      } catch {
        return { type: "output", data: { text: trimmed } };
      }
    },

    formatInput(message: string): string {
      const lines: string[] = [];

      // Codex app-server uses JSON-RPC with thread/turn protocol
      if (!initialized) {
        initialized = true;
        lines.push(
          JSON.stringify({
            jsonrpc: "2.0",
            id: nextId++,
            method: "initialize",
            params: {
              clientInfo: { name: "bob-gateway", version: "0.1.0" },
              protocolVersion: "1.0",
            },
          }),
        );
      }

      if (!threadStarted) {
        threadStarted = true;
        lines.push(
          JSON.stringify({
            jsonrpc: "2.0",
            id: nextId++,
            method: "thread/start",
            params: {
              cwd: workingDirectory,
            },
          }),
        );
      }

      // Send the message as a turn
      lines.push(
        JSON.stringify({
          jsonrpc: "2.0",
          id: nextId++,
          method: "turn/start",
          params: {
            prompt: [{ type: "text", text: message }],
          },
        }),
      );

      return lines.join("\n") + "\n";
    },
  };
}
