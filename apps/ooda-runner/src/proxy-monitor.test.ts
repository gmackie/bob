import { describe, expect, it } from "vitest";

import { collectProxySnapshot } from "./proxy-monitor";

// The proxy holds the accounts that serve production inference; the heartbeat
// must describe it. Shapes recorded from CLIProxyAPI's management API.

const route = { baseUrl: "http://proxy.internal:8317", apiKey: "proxy-key" };
const now = new Date("2026-09-20T12:00:00.000Z");

type Call = { url: string; auth: string | null };

function proxyStub(input: {
  models?: number;
  management?: { status: number; body: unknown };
  calls?: Call[];
}) {
  return async (target: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const request = new Request(target, init);
    input.calls?.push({ url: request.url, auth: request.headers.get("authorization") });
    if (request.url.endsWith("/v1/models")) {
      return new Response(JSON.stringify({ data: [{ id: "claude-sonnet-4-5" }] }), {
        status: input.models ?? 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (request.url.includes("/v0/management/auth-files")) {
      const m = input.management ?? { status: 200, body: { observed_at: now.toISOString(), files: [] } };
      return new Response(JSON.stringify(m.body), { status: m.status, headers: { "content-type": "application/json" } });
    }
    return new Response("not found", { status: 404 });
  };
}

describe("collectProxySnapshot", () => {
  it("reports a reachable proxy with folded, redacted accounts", async () => {
    const calls: Call[] = [];
    const snapshot = await collectProxySnapshot(
      {
        route,
        managementKey: "mgmt-key",
        fetch: proxyStub({
          calls,
          management: {
            status: 200,
            body: {
              observed_at: now.toISOString(),
              files: [
                { id: "claude-1", provider: "claude", status: "active", email: "graham@example.com", recent_requests: [] },
                { id: "codex-1", provider: "codex", status: "active", email: "g@example.com", recent_requests: [] },
              ],
            },
          },
        }),
      },
      now,
    );
    expect(snapshot).toMatchObject({
      origin: "http://proxy.internal:8317",
      reachable: true,
      checkedAt: now.toISOString(),
    });
    expect(snapshot.accounts?.map((a) => [a.provider, a.label, a.status])).toEqual([
      ["claude", "g…@example.com", "ready"],
      ["codex", "g…@example.com", "ready"],
    ]);
    expect(snapshot.usage).toEqual({ total: { success: 0, failed: 0 }, byProvider: { claude: { success: 0, failed: 0 }, codex: { success: 0, failed: 0 } } });
    expect(JSON.stringify(snapshot)).not.toContain("graham");
    expect(typeof snapshot.latencyMs).toBe("number");
  });

  it("uses the proxy key for inference and the management key for management, never the other way round", async () => {
    const calls: Call[] = [];
    await collectProxySnapshot({ route, managementKey: "mgmt-key", fetch: proxyStub({ calls }) }, now);
    const models = calls.find((c) => c.url.endsWith("/v1/models"));
    const mgmt = calls.find((c) => c.url.includes("/v0/management/auth-files"));
    expect(models?.auth).toBe("Bearer proxy-key");
    expect(mgmt?.auth).toBe("Bearer mgmt-key");
  });

  it("still reports reachability without a management key, and says why accounts are absent", async () => {
    const calls: Call[] = [];
    const snapshot = await collectProxySnapshot({ route, fetch: proxyStub({ calls }) }, now);
    expect(snapshot.reachable).toBe(true);
    expect(snapshot.accounts).toBeUndefined();
    expect(snapshot.managementError).toMatch(/management key/i);
    expect(calls.some((c) => c.url.includes("/v0/management"))).toBe(false);
  });

  it("reports the management failure without losing reachability", async () => {
    const snapshot = await collectProxySnapshot(
      { route, managementKey: "wrong", fetch: proxyStub({ management: { status: 401, body: { error: "invalid management key" } } }) },
      now,
    );
    expect(snapshot.reachable).toBe(true);
    expect(snapshot.accounts).toBeUndefined();
    expect(snapshot.managementError).toMatch(/401/);
  });

  it("reports an unreachable proxy", async () => {
    const snapshot = await collectProxySnapshot(
      {
        route,
        managementKey: "mgmt-key",
        fetch: async () => {
          throw new TypeError("fetch failed");
        },
      },
      now,
    );
    expect(snapshot).toMatchObject({ reachable: false, origin: "http://proxy.internal:8317" });
    expect(snapshot.accounts).toBeUndefined();
  });

  it("never puts a key or a path into the origin", async () => {
    const snapshot = await collectProxySnapshot(
      { route: { baseUrl: "http://proxy.internal:8317/some/base/", apiKey: "proxy-key" }, fetch: proxyStub({}) },
      now,
    );
    expect(snapshot.origin).toBe("http://proxy.internal:8317");
    expect(JSON.stringify(snapshot)).not.toContain("proxy-key");
  });
});
