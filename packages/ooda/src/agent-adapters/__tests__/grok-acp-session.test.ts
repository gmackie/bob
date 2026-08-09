import { describe, expect, it, vi } from "vitest";

import { AcpClient } from "../acp-client";
import { runGrokAcpSession } from "../grok-acp";

/**
 * Build a real AcpClient wired to a scripted "agent" that answers each
 * outbound request via `responder`. This exercises the real protocol
 * plumbing (no mocks of AcpClient itself).
 */
function scriptedClient(
  responder: (method: string, params: unknown) => unknown,
): { client: AcpClient; methods: string[] } {
  const methods: string[] = [];
  let client!: AcpClient;
  client = new AcpClient({
    write: (data) => {
      const msg = JSON.parse(data) as {
        id?: number;
        method?: string;
        params?: unknown;
      };
      if (typeof msg.id === "number" && typeof msg.method === "string") {
        methods.push(msg.method);
        const result = responder(msg.method, msg.params);
        // A responder returning `undefined` models an agent that never
        // replies to that request (used to exercise timeouts).
        if (result === undefined) return;
        queueMicrotask(() =>
          client.feed(
            JSON.stringify({ jsonrpc: "2.0", id: msg.id, result }) + "\n",
          ),
        );
      }
    },
    onNotification: () => {},
  });
  return { client, methods };
}

describe("runGrokAcpSession", () => {
  it("drives initialize -> session/new -> session/prompt in order", async () => {
    const { client, methods } = scriptedClient((method) => {
      switch (method) {
        case "initialize":
          return { protocolVersion: 1, authMethods: [] };
        case "session/new":
          return { sessionId: "sess_1" };
        case "session/prompt":
          return { stopReason: "end_turn" };
        default:
          return {};
      }
    });

    const result = await runGrokAcpSession({
      client,
      prompt: "do the thing",
      cwd: "/tmp/ws",
      apiKeyPresent: true,
    });

    expect(methods).toEqual(["initialize", "session/new", "session/prompt"]);
    expect(result.exitCode).toBe(0);
    expect(result.sessionId).toBe("sess_1");
  });

  it("authenticates when no API key is present and the agent offers an auth method", async () => {
    const { client, methods } = scriptedClient((method) => {
      switch (method) {
        case "initialize":
          return { protocolVersion: 1, authMethods: [{ id: "api-key" }] };
        case "authenticate":
          return {};
        case "session/new":
          return { sessionId: "sess_2" };
        case "session/prompt":
          return { stopReason: "end_turn" };
        default:
          return {};
      }
    });

    await runGrokAcpSession({
      client,
      prompt: "x",
      cwd: "/tmp/ws",
      apiKeyPresent: false,
    });

    expect(methods).toEqual([
      "initialize",
      "authenticate",
      "session/new",
      "session/prompt",
    ]);
  });

  it("does not authenticate when an API key is present", async () => {
    const { client, methods } = scriptedClient((method) => {
      switch (method) {
        case "initialize":
          return { protocolVersion: 1, authMethods: [{ id: "api-key" }] };
        case "session/new":
          return { sessionId: "s" };
        case "session/prompt":
          return { stopReason: "end_turn" };
        default:
          return {};
      }
    });

    await runGrokAcpSession({
      client,
      prompt: "x",
      cwd: "/tmp/ws",
      apiKeyPresent: true,
    });

    expect(methods).not.toContain("authenticate");
  });

  it("resumes a provider-native session when ACP advertises loadSession", async () => {
    const { client, methods } = scriptedClient((method) => {
      switch (method) {
        case "initialize":
          return {
            protocolVersion: 1,
            authMethods: [],
            agentCapabilities: { loadSession: true },
          };
        case "session/load":
          return {};
        case "session/prompt":
          return { stopReason: "end_turn" };
        default:
          return {};
      }
    });

    const result = await runGrokAcpSession({
      client,
      prompt: "continue the comparison",
      cwd: "/tmp/ws",
      apiKeyPresent: true,
      existingSessionId: "grok-session-1",
    });

    expect(methods).toEqual(["initialize", "session/load", "session/prompt"]);
    expect(result).toEqual({ exitCode: 0, sessionId: "grok-session-1" });
  });

  it("fails visibly instead of silently starting over when ACP cannot resume", async () => {
    const { client, methods } = scriptedClient((method) => {
      if (method === "initialize") {
        return { protocolVersion: 1, authMethods: [], agentCapabilities: {} };
      }
      return {};
    });

    await expect(
      runGrokAcpSession({
        client,
        prompt: "continue",
        cwd: "/tmp/ws",
        apiKeyPresent: true,
        existingSessionId: "grok-session-1",
      }),
    ).rejects.toThrow(/does not support session resume/i);
    expect(methods).toEqual(["initialize"]);
  });

  it("returns a non-zero exit code when the prompt stops with a refusal", async () => {
    const { client } = scriptedClient((method) => {
      switch (method) {
        case "initialize":
          return { protocolVersion: 1, authMethods: [] };
        case "session/new":
          return { sessionId: "s" };
        case "session/prompt":
          return { stopReason: "refusal" };
        default:
          return {};
      }
    });

    const result = await runGrokAcpSession({
      client,
      prompt: "x",
      cwd: "/tmp/ws",
      apiKeyPresent: true,
    });

    expect(result.exitCode).toBe(1);
  });

  it("rejects when a request exceeds the timeout", async () => {
    vi.useFakeTimers();
    try {
      // Agent answers the handshake but never responds to session/prompt.
      const { client } = scriptedClient((method) => {
        switch (method) {
          case "initialize":
            return { protocolVersion: 1, authMethods: [] };
          case "session/new":
            return { sessionId: "s" };
          // session/prompt: intentionally no response.
          default:
            return undefined;
        }
      });

      const promise = runGrokAcpSession({
        client,
        prompt: "x",
        cwd: "/tmp/ws",
        apiKeyPresent: true,
        timeoutMs: 1000,
      });
      const assertion = expect(promise).rejects.toThrow(/timed out/i);

      await vi.advanceTimersByTimeAsync(1001);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });
});
