import { describe, expect, it } from "vitest";

import { ProxyControl } from "./proxy-control";

// The proxy's management key lives on the runner host and nowhere else, so
// the runner is the only place that can act on an account. The UI asks over
// the gateway; the answer is a proxy_control_result plus a fresh snapshot.

const route = { baseUrl: "http://proxy.internal:8317", apiKey: "proxy-key" };

type Call = { method: string; url: string; auth: string | null; body: unknown };

function harness(input: {
  managementKey?: string;
  accounts?: Array<{ id: string; ref?: { name?: string; authIndex?: string } }>;
  status?: number;
  modelsStatus?: number;
}) {
  const calls: Call[] = [];
  const sent: Record<string, unknown>[] = [];
  let refreshed = 0;
  const control = new ProxyControl({
    route,
    managementKey: input.managementKey,
    send: (msg) => sent.push(msg),
    accounts: () =>
      (input.accounts ?? []).map((a) => ({
        id: a.id,
        provider: "claude",
        label: "g…@x",
        status: "ready",
        requests24h: { success: 0, failed: 0 },
        ...(a.ref ? { ref: a.ref } : {}),
      })),
    refreshSnapshot: async () => {
      refreshed += 1;
    },
    fetch: async (target, init) => {
      const request = new Request(target, init);
      let body: unknown = null;
      try {
        body = init?.body ? JSON.parse(String(init.body)) : null;
      } catch {
        body = String(init?.body);
      }
      calls.push({ method: request.method, url: request.url, auth: request.headers.get("authorization"), body });
      const status = request.url.endsWith("/v1/models") ? (input.modelsStatus ?? 200) : (input.status ?? 200);
      return new Response(JSON.stringify({ ok: status < 400 }), { status, headers: { "content-type": "application/json" } });
    },
  });
  return { control, calls, sent, refreshed: () => refreshed };
}

describe("ProxyControl", () => {
  it("disables an account by its file name with the management key, then refreshes the snapshot", async () => {
    const h = harness({ managementKey: "mgmt", accounts: [{ id: "claude-1", ref: { name: "claude-1.json" } }] });
    await h.control.apply("req-1", "disable", "claude-1");
    expect(h.calls).toEqual([
      {
        method: "PATCH",
        url: "http://proxy.internal:8317/v0/management/auth-files/status",
        auth: "Bearer mgmt",
        body: { name: "claude-1.json", disabled: true },
      },
    ]);
    expect(h.sent).toEqual([{ type: "proxy_control_result", requestId: "req-1", ok: true }]);
    expect(h.refreshed()).toBe(1);
  });

  it("enables with disabled=false and prefers auth_index when the proxy gave one", async () => {
    const h = harness({ managementKey: "mgmt", accounts: [{ id: "c", ref: { name: "c.json", authIndex: "idx-3" } }] });
    await h.control.apply("req-2", "enable", "c");
    expect(h.calls[0]!.body).toEqual({ auth_index: "idx-3", disabled: false });
  });

  it("refreshes one account", async () => {
    const h = harness({ managementKey: "mgmt", accounts: [{ id: "c", ref: { name: "c.json" } }] });
    await h.control.apply("req-3", "refresh", "c");
    expect(h.calls[0]).toMatchObject({
      method: "POST",
      url: "http://proxy.internal:8317/v0/management/auth-files/refresh",
      body: { name: "c.json" },
    });
  });

  it("tests the connection with the inference key, not the management key", async () => {
    const h = harness({ managementKey: "mgmt" });
    await h.control.apply("req-4", "test");
    expect(h.calls).toEqual([
      { method: "GET", url: "http://proxy.internal:8317/v1/models", auth: "Bearer proxy-key", body: null },
    ]);
    expect(h.sent[0]).toMatchObject({ ok: true });
  });

  it("refuses account actions without a management key, and says so", async () => {
    const h = harness({ accounts: [{ id: "c", ref: { name: "c.json" } }] });
    await h.control.apply("req-5", "disable", "c");
    expect(h.calls).toEqual([]);
    expect(h.sent[0]).toMatchObject({ ok: false, detail: expect.stringMatching(/CLIPROXY_MANAGEMENT_KEY/) });
  });

  it("refuses an account it has not seen in a heartbeat", async () => {
    // The UI names accounts by the id the runner itself reported; anything
    // else is stale or forged and must not reach the proxy.
    const h = harness({ managementKey: "mgmt", accounts: [{ id: "c", ref: { name: "c.json" } }] });
    await h.control.apply("req-6", "disable", "nope");
    expect(h.calls).toEqual([]);
    expect(h.sent[0]).toMatchObject({ ok: false, detail: expect.stringMatching(/unknown account/i) });
  });

  it("reports the proxy's refusal instead of claiming success", async () => {
    const h = harness({ managementKey: "wrong", status: 401, accounts: [{ id: "c", ref: { name: "c.json" } }] });
    await h.control.apply("req-7", "refresh", "c");
    expect(h.sent[0]).toMatchObject({ ok: false, detail: expect.stringMatching(/401/) });
    // Still refresh: the panel should show whatever the proxy says now.
    expect(h.refreshed()).toBe(1);
  });

  it("never echoes a key in a result", async () => {
    const h = harness({ managementKey: "super-secret-mgmt", status: 500, accounts: [{ id: "c", ref: { name: "c.json" } }] });
    await h.control.apply("req-8", "refresh", "c");
    expect(JSON.stringify(h.sent)).not.toContain("super-secret");
    expect(JSON.stringify(h.sent)).not.toContain("proxy-key");
  });
});
