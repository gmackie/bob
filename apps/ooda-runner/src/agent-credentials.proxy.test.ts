import { describe, expect, it } from "vitest";

import { AgentCredentials } from "./agent-credentials";

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
