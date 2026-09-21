import { afterEach, describe, expect, it, vi } from "vitest";

import { proxyControlSet } from "./proxyControl";

// Same shape as dispatchControl: authorise the caller, relay to the gateway,
// which forwards to the workspace's daemon. The daemon holds the proxy's
// management key; this handler never sees it.

const owner = { id: "ws-1", ownerUserId: "user-owner" };

function ctx(user: string, workspace: typeof owner | undefined = owner) {
  return {
    db: { query: { workspaces: { findFirst: () => Promise.resolve(workspace) } } },
    userId: user,
  } as unknown as Parameters<typeof proxyControlSet>[0];
}

const input = { workspaceId: "ws-1", action: "disable" as const, accountId: "claude-1", requestId: "req-12345678" };

describe("proxyControlSet", () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
    delete process.env.GATEWAY_URL;
    delete process.env.NUDGE_SHARED_SECRET;
  });

  it("relays an owner's request to the gateway's internal endpoint", async () => {
    process.env.GATEWAY_URL = "http://gateway.internal";
    process.env.NUDGE_SHARED_SECRET = "shared";
    const calls: { url: string; body: string; authorization: string | null }[] = [];
    globalThis.fetch = async (url: string | URL | Request, init?: RequestInit) => {
      const request = new Request(url, init);
      calls.push({ url: request.url, body: await request.text(), authorization: request.headers.get("authorization") });
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    };

    const result = await proxyControlSet(ctx("user-owner"), input);
    expect(result).toEqual({ ok: true, requestId: "req-12345678" });
    expect(calls[0]?.url).toBe("http://gateway.internal/internal/proxy-control");
    expect(JSON.parse(calls[0]?.body ?? "null")).toEqual({
      workspaceId: "ws-1",
      action: "disable",
      accountId: "claude-1",
      requestId: "req-12345678",
    });
    expect(calls[0]?.authorization).toBe("Bearer shared");
  });

  it("refuses a non-owner: enabling an account spends the owner's subscription", async () => {
    process.env.GATEWAY_URL = "http://gateway.internal";
    process.env.NUDGE_SHARED_SECRET = "shared";
    const fetchSpy = vi.fn<typeof fetch>();
    globalThis.fetch = fetchSpy;
    await expect(proxyControlSet(ctx("user-other"), input)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("says the daemon is offline when the gateway has no daemon, rather than a generic failure", async () => {
    process.env.GATEWAY_URL = "http://gateway.internal";
    process.env.NUDGE_SHARED_SECRET = "shared";
    globalThis.fetch = () => Promise.resolve(new Response(JSON.stringify({ error: "no daemon" }), { status: 503 }));
    const attempt = proxyControlSet(ctx("user-owner"), input);
    await expect(attempt).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    await expect(attempt).rejects.toThrow(/not connected/i);
  });

  it("fails clearly when the gateway is not configured", async () => {
    await expect(proxyControlSet(ctx("user-owner"), input)).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  });
});
