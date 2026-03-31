import type { ParsedEvent, StdioAdapter } from "./base-stdio-adapter.js";

let nextId = 1;

const ACP_PROTOCOL_VERSION = 1;

function buildRequest(method: string, params: Record<string, unknown>) {
  return JSON.stringify({
    jsonrpc: "2.0",
    id: nextId++,
    method,
    params,
  });
}

export function createSmolAgentAcpAdapter(
  workingDirectory: string,
  runtimeEnv: Record<string, string> = {},
): StdioAdapter {
  let initialized = false;
  let sessionRequested = false;
  let sessionId: string | null = null;
  let pendingPrompt: string | null = null;

  const mcpServers =
    runtimeEnv.BOB_SECRET_BROKER_URL && runtimeEnv.BOB_SECRET_BROKER_TOKEN
      ? {
          bob: {
            command: "npx",
            args: ["@bob/mcp-server"],
            env: {
              ...(runtimeEnv.BOB_API_URL
                ? { BOB_API_URL: runtimeEnv.BOB_API_URL }
                : {}),
              ...(runtimeEnv.BOB_API_KEY
                ? { BOB_API_KEY: runtimeEnv.BOB_API_KEY }
                : {}),
              ...(runtimeEnv.BOB_SESSION_ID
                ? { BOB_SESSION_ID: runtimeEnv.BOB_SESSION_ID }
                : {}),
              BOB_SECRET_BROKER_URL: runtimeEnv.BOB_SECRET_BROKER_URL,
              BOB_SECRET_BROKER_TOKEN: runtimeEnv.BOB_SECRET_BROKER_TOKEN,
              ...(runtimeEnv.BOB_SESSION_SECRET_MANIFEST
                ? {
                    BOB_SESSION_SECRET_MANIFEST:
                      runtimeEnv.BOB_SESSION_SECRET_MANIFEST,
                  }
                : {}),
            },
          },
        }
      : {};

  function buildPromptRequest(text: string) {
    return buildRequest("session/prompt", {
      sessionId,
      prompt: [
        {
          type: "text",
          text,
        },
      ],
    });
  }

  return {
    command: "smol-agent",
    args: ["--acp", "--directory", workingDirectory],
    env: {
      SMOL_AGENT_NO_BROWSER: "1",
    },

    parseLine(line: string): ParsedEvent | null {
      const trimmed = line.trim();
      if (!trimmed) return null;

      try {
        const msg = JSON.parse(trimmed) as Record<string, unknown>;

        if (msg.method === "session/update") {
          const params = (msg.params as Record<string, unknown>) ?? {};
          const update = (params.update as Record<string, unknown>) ?? {};
          const content = (update.content as Record<string, unknown>) ?? {};

          switch (update.sessionUpdate) {
            case "agent_message_chunk":
            case "agent_thought_chunk":
              return {
                type: "output",
                data: { text: (content.text as string) ?? "" },
              };
            case "tool_call":
              return {
                type: "tool_call",
                data: {
                  toolCallId: update.toolCallId as string,
                  name: update.title as string,
                  arguments: JSON.stringify(update.rawInput ?? {}),
                },
              };
            case "tool_call_update":
              return {
                type: "tool_result",
                data: {
                  toolCallId: update.toolCallId as string,
                  result: JSON.stringify(update.rawOutput ?? {}),
                  isError: update.status === "failed",
                },
              };
            default:
              return null;
          }
        }

        if (msg.error) {
          const err = msg.error as Record<string, unknown>;
          return {
            type: "error",
            data: { message: (err.message as string) ?? "ACP error" },
          };
        }

        if (msg.result && !sessionId) {
          const result = msg.result as Record<string, unknown>;
          if (typeof result.sessionId === "string") {
            sessionId = result.sessionId;

            const followUpInput = pendingPrompt
              ? buildPromptRequest(pendingPrompt)
              : undefined;
            pendingPrompt = null;

            return {
              type: "status",
              data: {
                status: "session_ready",
                sessionId,
                followUpInput,
              },
            };
          }
        }

        return null;
      } catch {
        return {
          type: "output",
          data: { text: trimmed },
        };
      }
    },

    formatInput(message: string): string {
      if (sessionId) {
        return `${buildPromptRequest(message)}\n`;
      }

      pendingPrompt = message;

      const lines: string[] = [];

      if (!initialized) {
        initialized = true;
        lines.push(
          buildRequest("initialize", {
            protocolVersion: ACP_PROTOCOL_VERSION,
            clientCapabilities: {},
            clientInfo: {
              name: "bob-gateway",
              version: "0.1.0",
            },
          }),
        );
      }

      if (!sessionRequested) {
        sessionRequested = true;
        lines.push(
          buildRequest("session/new", {
            cwd: workingDirectory,
            mcpServers,
          }),
        );
      }

      return lines.length > 0 ? `${lines.join("\n")}\n` : "";
    },
  };
}
