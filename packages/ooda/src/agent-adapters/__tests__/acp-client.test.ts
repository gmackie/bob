import { describe, expect, it, vi } from "vitest";

import { AcpClient } from "../acp-client";

describe("AcpClient", () => {
  it("correlates a response to its request by id and resolves with the result", async () => {
    const written: string[] = [];
    const client = new AcpClient({
      write: (data) => written.push(data),
      onNotification: () => {},
    });

    const promise = client.request("initialize", { protocolVersion: 1 });

    // The client should have written a JSON-RPC request with an id.
    expect(written).toHaveLength(1);
    const sent = JSON.parse(written[0]!);
    expect(sent.jsonrpc).toBe("2.0");
    expect(sent.method).toBe("initialize");
    expect(sent.params).toEqual({ protocolVersion: 1 });
    expect(typeof sent.id).toBe("number");

    // Agent replies with a matching response.
    client.feed(
      JSON.stringify({ jsonrpc: "2.0", id: sent.id, result: { ok: true } }) + "\n",
    );

    await expect(promise).resolves.toEqual({ ok: true });
  });

  it("rejects when the agent returns a JSON-RPC error", async () => {
    const client = new AcpClient({ write: () => {}, onNotification: () => {} });
    const promise = client.request("session/new", {});
    // Find the id we just used (ids start at 1).
    client.feed(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        error: { code: -32000, message: "boom" },
      }) + "\n",
    );
    await expect(promise).rejects.toThrow("boom");
  });

  it("fans out notifications (no id) to onNotification", () => {
    const onNotification = vi.fn();
    const client = new AcpClient({ write: () => {}, onNotification });

    client.feed(
      JSON.stringify({
        jsonrpc: "2.0",
        method: "session/update",
        params: { sessionId: "s1", update: { kind: "agent_message_chunk" } },
      }) + "\n",
    );

    expect(onNotification).toHaveBeenCalledWith("session/update", {
      sessionId: "s1",
      update: { kind: "agent_message_chunk" },
    });
  });

  it("answers an agent->client request using onRequest and writes the response", async () => {
    const written: string[] = [];
    const onRequest = vi.fn().mockResolvedValue({ granted: true });
    const client = new AcpClient({
      write: (data) => written.push(data),
      onNotification: () => {},
      onRequest,
    });

    client.feed(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 42,
        method: "session/request_permission",
        params: { toolCall: "write" },
      }) + "\n",
    );

    // Let the async onRequest resolve.
    await vi.waitFor(() => expect(written).toHaveLength(1));
    const response = JSON.parse(written[0]!);
    expect(response.id).toBe(42);
    expect(response.result).toEqual({ granted: true });
    expect(onRequest).toHaveBeenCalledWith("session/request_permission", {
      toolCall: "write",
    });
  });

  it("buffers partial lines and only parses on newline boundaries", async () => {
    const client = new AcpClient({ write: () => {}, onNotification: () => {} });
    const promise = client.request("ping", {});
    const full = JSON.stringify({ jsonrpc: "2.0", id: 1, result: "pong" });
    // Feed the response split across two chunks, newline only in the second.
    client.feed(full.slice(0, 10));
    client.feed(full.slice(10) + "\n");
    await expect(promise).resolves.toBe("pong");
  });
});
