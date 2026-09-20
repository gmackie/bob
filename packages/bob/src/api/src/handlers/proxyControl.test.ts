import { afterEach, describe, expect, it, vi } from "vitest";

import { proxyControlSet } from "./proxyControl";

// Same shape as dispatchControl: authorise the caller, relay to the gateway,
// which forwards to the workspace's daemon. The daemon holds the proxy's
// management key; this handler never sees it.

const owner = { id: "ws-1", ownerUserId: "user-owner" };

function ctx(user: string, workspace: typeof owner | undefined = owner) {
  return {
    db: { query: { workspaces: { findFirst: async () => workspace } } },
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
    const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }) as typeof fetch;

    const result = await proxyControlSet(ctx("user-owner"), input);
    expect(result).toEqual({ ok: true, requestId: "req-12345678" });
    expect(calls[0]!.url).toBe("http://gateway.internal/internal/proxy-control");
    expect(JSON.parse(String(calls[0]!.init?.body))).toEqual({
      workspaceId: "ws-1",
      action: "disable",
      accountId: "claude-1",
      requestId: "req-12345678",
    });
    expect((calls[0]!.init?.headers as Record<string, string>).Authorization).toBe("Bearer shared");
  });

  it("refuses a non-owner: enabling an account spends the owner's subscription", async () => {
    process.env.GATEWAY_URL = "http://gateway.internal";
    process.env.NUDGE_SHARED_SECRET = "shared";
    globalThis.fetch = vi.fn() as unknown as typeof fetch;
    await expect(proxyControlSet(ctx("user-other"), input)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("says the daemon is offline when the gateway has no daemon, rather than a generic failure", async () => {
    process.env.GATEWAY_URL = "http://gateway.internal";
    process.env.NUDGE_SHARED_SECRET = "shared";
    globalThis.fetch = (async () => new Response(JSON.stringify({ error: "no daemon" }), { status: 503 })) as typeof fetch;
    await expect(proxyControlSet(ctx("user-owner"), input)).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
      message: expect.stringMatching(/not connected/i),
    });
  });

  it("fails clearly when the gateway is not configured", async () => {
    await expect(proxyControlSet(ctx("user-owner"), input)).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  });
});
