import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { AgentCredentials } from "./agent-credentials";

// The credit latch is a shared file; on the production runner it can hold a
// real "rate limited" outcome that would leak into these assertions.
let latchDir: string;
beforeEach(() => {
  latchDir = mkdtempSync(join(tmpdir(), "ooda-proxy-creds-"));
  process.env.BOB_CREDIT_STATE_PATH = join(latchDir, "credit-state.json");
});
afterEach(() => {
  delete process.env.BOB_CREDIT_STATE_PATH;
  rmSync(latchDir, { recursive: true, force: true });
});

// On the production runner the host credential probe reported Grok "missing"
// and sat in a failed unit while the proxy behind it held a working account.
// The heartbeat must describe the source that serves runs.

function credentials(input: {
  environment: Record<string, string | undefined>;
  models: string[];
  proxyStatus?: number;
  hostAuthCalls: string[];
}) {
  return new AgentCredentials({
    hostId: "runner-a",
    daemonVersion: "test",
    send: () => {},
    queueDepth: () => 0,
    environment: input.environment,
    run: (command, args) => {
      if (args[0] !== "--version") input.hostAuthCalls.push(command);
      return Promise.resolve(
        args[0] === "--version"
          ? { code: 0, stdout: "1.0.0", stderr: "" }
          : { code: 1, stdout: "", stderr: "not logged in on host" },
      );
    },
    fetch: async () =>
      new Response(JSON.stringify({ data: input.models.map((id) => ({ id })) }), {
        status: input.proxyStatus ?? 200,
        headers: { "content-type": "application/json" },
      }),
  });
}

const onProxy = { CLIPROXY_BASE_URL: "http://proxy.internal:8317", CLIPROXY_API_KEY: "k" };

describe("AgentCredentials host snapshot via the inference proxy", () => {
  it("reports Claude and Codex from the proxy, and providers it cannot serve from the host", async () => {
    const hostAuthCalls: string[] = [];
    const snapshot = await credentials({
      environment: onProxy,
      models: ["claude-sonnet-4-5", "gpt-5-codex"],
      hostAuthCalls,
    }).hostSnapshot(true);

    const byProvider = Object.fromEntries(snapshot.providers.map((p) => [p.provider, p]));
    expect(byProvider.claude).toMatchObject({ status: "ready", via: "proxy" });
    expect(byProvider.codex).toMatchObject({ status: "ready", via: "proxy" });
    // Grok and Cursor have no proxy transport: still host-probed, and this host
    // is not logged in to them.
    expect(byProvider.grok).toMatchObject({ status: "unauthenticated", via: "host" });
    expect(byProvider["cursor-agent"]).toMatchObject({ status: "unauthenticated", via: "host" });
    // The host login checks for the proxied providers were never consulted.
    expect(hostAuthCalls.sort()).toEqual(["cursor-agent", "grok"]);
  });

  it("reports proxy_unreachable for proxied providers when the proxy is down", async () => {
    const creds = new AgentCredentials({
      hostId: "runner-a",
      daemonVersion: "test",
      send: () => {},
      queueDepth: () => 0,
      environment: onProxy,
      run: () => Promise.resolve({ code: 0, stdout: "ok", stderr: "" }),
      fetch: async () => {
        throw new TypeError("fetch failed");
      },
    });
    const snapshot = await creds.hostSnapshot(true);
    const claude = snapshot.providers.find((p) => p.provider === "claude");
    expect(claude).toMatchObject({ status: "proxy_unreachable", via: "proxy" });
  });

  it("stays on the host probe when no proxy route is configured", async () => {
    const hostAuthCalls: string[] = [];
    const snapshot = await credentials({ environment: {}, models: [], hostAuthCalls }).hostSnapshot(true);
    expect(snapshot.providers.every((p) => p.via === "host")).toBe(true);
    expect(hostAuthCalls).toHaveLength(4);
  });

  it("attaches the proxy snapshot to the heartbeat when a route is configured, and not otherwise", async () => {
    const withRoute = await credentials({ environment: onProxy, models: ["claude-sonnet-4-5"], hostAuthCalls: [] }).hostSnapshot(true);
    expect(withRoute.proxy).toMatchObject({ origin: "http://proxy.internal:8317", reachable: true });
    expect(withRoute.proxy?.managementError).toMatch(/management key/i);

    const withoutRoute = await credentials({ environment: {}, models: [], hostAuthCalls: [] }).hostSnapshot(true);
    expect(withoutRoute.proxy).toBeUndefined();
  });

  it("downgrades a provider from the proxy's account states, but never upgrades a failure", async () => {
    // Every Claude account is cooling down; Codex has a ready one. The /v1/models
    // probe alone would call both ready — the accounts are the finer truth.
    const creds = new AgentCredentials({
      hostId: "runner-a",
      daemonVersion: "test",
      send: () => {},
      queueDepth: () => 0,
      environment: { ...onProxy, CLIPROXY_MANAGEMENT_KEY: "mgmt" },
      run: () => Promise.resolve({ code: 0, stdout: "ok", stderr: "" }),
      fetch: async (target) => {
        const url = typeof target === "string" ? target : target instanceof URL ? target.toString() : target.url;
        if (url.includes("/v0/management/auth-files")) {
          return new Response(
            JSON.stringify({
              files: [
                { id: "c1", provider: "claude", status: "active", cooldowns: [{ retry_at: "2999-01-01T00:00:00Z", reason: "rate_limited" }] },
                { id: "c2", provider: "claude", status: "active", cooldowns: [{ retry_at: "2999-01-01T00:00:00Z" }] },
                { id: "x1", provider: "codex", status: "active" },
              ],
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        return new Response(JSON.stringify({ data: [{ id: "claude-sonnet-4-5" }, { id: "gpt-5-codex" }] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      },
    });
    const snapshot = await creds.hostSnapshot(true);
    const byProvider = Object.fromEntries(snapshot.providers.map((p) => [p.provider, p]));
    expect(byProvider.claude).toMatchObject({ status: "rate_limited", via: "proxy" });
    expect(byProvider.claude!.error).toMatch(/cooling down/i);
    expect(byProvider.codex).toMatchObject({ status: "ready", via: "proxy" });
    expect(snapshot.proxy?.accounts?.map((a) => a.status)).toEqual(["cooldown", "cooldown", "ready"]);
  });

  it("lets an operator pin a provider back to the host probe", async () => {
    const hostAuthCalls: string[] = [];
    const snapshot = await credentials({
      environment: { ...onProxy, BOB_PROVIDER_AUTH_MODE_CLAUDE: "subscription" },
      models: ["claude-sonnet-4-5", "gpt-5-codex"],
      hostAuthCalls,
    }).hostSnapshot(true);
    const byProvider = Object.fromEntries(snapshot.providers.map((p) => [p.provider, p]));
    expect(byProvider.claude!.via).toBe("host");
    expect(byProvider.codex!.via).toBe("proxy");
  });
});
