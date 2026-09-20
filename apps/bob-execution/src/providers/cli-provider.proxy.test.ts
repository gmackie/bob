import { describe, expect, it } from "vitest";

import type { CommandResult } from "./cli-provider.js";
import { probeCliProvider } from "./cli-provider.js";

// The host probe checked `codex login status` and ~/.claude/.credentials.json
// while production inference went through the proxy. On the runner host that
// probe unit sat in a failed state reporting Grok "missing" with a working
// proxy account behind it. In proxy mode the probe must look at the proxy.

const cliInstalled = (_command: string, args: string[]): Promise<CommandResult> =>
  Promise.resolve(
    args[0] === "--version"
      ? { code: 0, stdout: "1.2.3\n", stderr: "" }
      : // A host-local auth check must not be consulted in proxy mode; make it
        // scream if it is.
        { code: 1, stdout: "", stderr: "not logged in (host)" },
  );

const route = { baseUrl: "http://proxy.internal:8317", apiKey: "proxy-key" };

function fetchReturning(status: number, body: unknown, seen: Request[] = []) {
  return (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    seen.push(new Request(input, init));
    return Promise.resolve(
      new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }),
    );
  };
}

describe("probeCliProvider via the inference proxy", () => {
  it("reports ready when the proxy accepts the key and lists the provider's models", async () => {
    const seen: Request[] = [];
    const snapshot = await probeCliProvider("claude", cliInstalled, new Date(), {}, {
      proxy: { ...route, fetch: fetchReturning(200, { data: [{ id: "claude-sonnet-4-5" }] }, seen) },
    });
    expect(snapshot).toMatchObject({ status: "ready", authenticated: true, installed: true, via: "proxy" });
    expect(seen[0]?.url).toBe("http://proxy.internal:8317/v1/models");
    expect(seen[0]?.headers.get("authorization")).toBe("Bearer proxy-key");
  });

  it("never consults the host-local login check in proxy mode", async () => {
    let hostAuthCalls = 0;
    const run = (_command: string, args: string[]): Promise<CommandResult> => {
      if (args[0] !== "--version") hostAuthCalls += 1;
      return cliInstalled(_command, args);
    };
    await probeCliProvider("codex", run, new Date(), {}, {
      proxy: { ...route, fetch: fetchReturning(200, { data: [{ id: "gpt-5-codex" }] }) },
    });
    expect(hostAuthCalls).toBe(0);
  });

  it("reports proxy_unreachable, not unavailable, when the proxy cannot be reached", async () => {
    // "unavailable" carries the remedy "install", which is the wrong action
    // for an installed CLI whose transport is down.
    const snapshot = await probeCliProvider("claude", cliInstalled, new Date(), {}, {
      proxy: { ...route, fetch: () => Promise.reject(new TypeError("fetch failed")) },
    });
    expect(snapshot).toMatchObject({ status: "proxy_unreachable", installed: true, via: "proxy" });
    expect(snapshot.error).toMatch(/proxy/i);
  });

  it("reports unauthenticated when the proxy rejects the key", async () => {
    const snapshot = await probeCliProvider("claude", cliInstalled, new Date(), {}, {
      proxy: { ...route, fetch: fetchReturning(401, { error: "unauthorized" }) },
    });
    expect(snapshot).toMatchObject({ status: "unauthenticated", authenticated: false, via: "proxy" });
    expect(snapshot.error).toMatch(/proxy/i);
  });

  it("reports degraded when the proxy is up but lists no models for the provider", async () => {
    // Uncertain, not confirmed dead: dispatch may still try. A missing model
    // list is a proxy configuration problem, not proof the account is gone.
    const snapshot = await probeCliProvider("codex", cliInstalled, new Date(), {}, {
      proxy: { ...route, fetch: fetchReturning(200, { data: [{ id: "claude-opus-4-1" }] }) },
    });
    expect(snapshot).toMatchObject({ status: "degraded", via: "proxy" });
    expect(snapshot.error).toMatch(/codex/i);
  });

  it("still lets a latched run outcome override a clean proxy probe", async () => {
    const snapshot = await probeCliProvider(
      "claude",
      cliInstalled,
      new Date(),
      { kind: "rate_limited", detail: "weekly cap reached" },
      { proxy: { ...route, fetch: fetchReturning(200, { data: [{ id: "claude-sonnet-4-5" }] }) } },
    );
    expect(snapshot).toMatchObject({ status: "rate_limited", detail: "weekly cap reached" });
  });

  it("still requires the CLI itself to be installed", async () => {
    const missing = (): Promise<CommandResult> => Promise.reject(new Error("spawn claude ENOENT"));
    const snapshot = await probeCliProvider("claude", missing, new Date(), {}, {
      proxy: { ...route, fetch: fetchReturning(200, { data: [] }) },
    });
    expect(snapshot.status).toBe("unavailable");
  });

  it("falls back to the host probe for a provider the proxy cannot serve", async () => {
    const snapshot = await probeCliProvider("grok", cliInstalled, new Date(), {}, {
      proxy: { ...route, fetch: fetchReturning(200, { data: [{ id: "grok-4" }] }) },
    });
    // cliInstalled fails the host auth check, so a host-path probe says so.
    expect(snapshot).toMatchObject({ status: "unauthenticated", via: "host" });
  });

  it("labels the host path so the UI can say which source it is showing", async () => {
    const ready = (_c: string, _a: string[]): Promise<CommandResult> =>
      Promise.resolve({ code: 0, stdout: "ok", stderr: "" });
    const snapshot = await probeCliProvider("claude", ready);
    expect(snapshot.via).toBe("host");
  });
});
