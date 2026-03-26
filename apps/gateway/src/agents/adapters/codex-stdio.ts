import type { StdioAdapter, ParsedEvent } from "./base-stdio-adapter.js";

let nextId = 1;

export function createCodexStdioAdapter(workingDirectory: string): StdioAdapter {
  let initialized = false;
  let threadStarted = false;
  let threadId: string | null = null;

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

        // JSON-RPC notification (no id) — Codex app-server protocol
        if (msg.method && !("id" in msg)) {
          const params = (msg.params as Record<string, unknown>) ?? {};
          const method = msg.method as string;

          // Item deltas — streaming agent message text
          if (method === "item/agentMessage/delta") {
            const delta = (params.delta as Record<string, unknown>) ?? {};
            return { type: "output", data: { text: (delta.text as string) ?? "" } };
          }

          // Turn lifecycle
          if (method === "turn/started") {
            return { type: "status", data: { status: "turn_started" } };
          }
          if (method === "turn/completed") {
            return { type: "status", data: { status: "completed" } };
          }

          // Item lifecycle — tool calls
          if (method === "item/started") {
            const item = (params.item as Record<string, unknown>) ?? {};
            if (item.type === "tool_call") {
              return {
                type: "tool_call",
                data: {
                  toolCallId: (item.id as string) ?? "",
                  name: (item.name as string) ?? "tool",
                  arguments: JSON.stringify(item.arguments ?? {}),
                },
              };
            }
            return null; // Skip other item/started events
          }

          if (method === "item/completed") {
            const item = (params.item as Record<string, unknown>) ?? {};
            if (item.type === "tool_call") {
              return {
                type: "tool_result",
                data: {
                  toolCallId: (item.id as string) ?? "",
                  result: JSON.stringify(item.output ?? ""),
                  isError: item.status === "failed",
                },
              };
            }
            return null;
          }

          // Token usage — skip (informational)
          if (method.startsWith("thread/tokenUsage")) return null;

          // Legacy format fallback
          switch (method) {
            case "events/output":
              return { type: "output", data: { text: (params.text as string) ?? "" } };
            case "events/error":
              return { type: "error", data: { message: (params.message as string) ?? "Unknown error" } };
            default:
              return null; // Skip unrecognized notifications instead of showing raw JSON
          }
        }

        // JSON-RPC response (has id, has result or error)
        if (msg.error) {
          const err = msg.error as Record<string, unknown>;
          return { type: "error", data: { message: (err.message as string) ?? "RPC error", code: err.code } };
        }

        // Track initialization and thread start responses
        if (msg.result !== undefined) {
          const result = msg.result as Record<string, unknown> | null;
          if (!initialized) {
            initialized = true;
          } else if (!threadStarted) {
            threadStarted = true;
            // Capture threadId from thread/start response
            if (result && typeof result.threadId === "string") {
              threadId = result.threadId;
            }
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
              threadId: `bob-thread-${Date.now()}`,
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
            ...(threadId ? { threadId } : {}),
            prompt: [{ type: "text", text: message }],
          },
        }),
      );

      return lines.join("\n") + "\n";
    },
  };
}
