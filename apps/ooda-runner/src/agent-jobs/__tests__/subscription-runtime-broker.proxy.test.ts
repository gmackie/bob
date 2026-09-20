import { describe, expect, it } from "vitest";

import { SubscriptionRuntimeBroker } from "../subscription-runtime-broker";

// Isolated OODA jobs used to bypass the inference proxy entirely: the broker
// forwarded only PATH/LANG/LC_ALL/TERM, so the proxy variables set on the host
// never reached a run, and every job copied OAuth credential files instead.
// These tests pin the proxy transport of the subscription mode.

const host = {
  PATH: "/usr/bin",
  HOME: "/Users/operator",
  CLIPROXY_BASE_URL: "http://proxy.internal:8317",
  CLIPROXY_API_KEY: "proxy-key",
  // Host-level convenience variables from the runbook's env file. The broker
  // derives its own from the route rather than trusting these blindly.
  ANTHROPIC_BASE_URL: "http://stale.example",
  OPENAI_BASE_URL: "http://stale.example/v1",
  ANTHROPIC_API_KEY: "metered-key",
  OPENAI_API_KEY: "metered-key",
  DATABASE_URL: "must-not-leak",
};

function prepare(provider: string, source: Record<string, string | undefined> = host) {
  return new SubscriptionRuntimeBroker().prepare({
    provider,
    jobClass: "read_only_research",
    capabilities: ["web.read"],
    billingPolicy: "subscription_only",
    authMode: "subscription",
    sandboxPath: "/tmp/ooda-job",
    credentialHomePath: "/tmp/ooda-credentials",
    source,
  });
}

describe("SubscriptionRuntimeBroker via the inference proxy", () => {
  it("routes Claude through the proxy without copying any OAuth file", () => {
    const prepared = prepare("claude");
    expect(prepared).toMatchObject({
      authMode: "subscription",
      credentialSource: "proxy",
      credentialCopies: [],
      credentialWrites: [],
      environment: {
        PATH: "/usr/bin",
        HOME: "/tmp/ooda-credentials",
        ANTHROPIC_BASE_URL: "http://proxy.internal:8317",
        ANTHROPIC_AUTH_TOKEN: "proxy-key",
      },
    });
    expect(prepared.environment).not.toHaveProperty("ANTHROPIC_API_KEY");
    expect(prepared.environment).not.toHaveProperty("OPENAI_API_KEY");
    expect(prepared.environment).not.toHaveProperty("DATABASE_URL");
    expect(prepared.environment).not.toHaveProperty("CLIPROXY_API_KEY");
  });

  it("routes Codex through the proxy with a per-run provider config, leaving the host config alone", () => {
    const prepared = prepare("codex");
    expect(prepared).toMatchObject({
      credentialSource: "proxy",
      credentialCopies: [],
      environment: {
        HOME: "/tmp/ooda-credentials",
        CODEX_HOME: "/tmp/ooda-credentials/.codex",
        OPENAI_BASE_URL: "http://proxy.internal:8317/v1",
        CLIPROXY_API_KEY: "proxy-key",
      },
    });
    expect(prepared.credentialWrites).toHaveLength(1);
    const [write] = prepared.credentialWrites;
    expect(write!.destinationPath).toBe("/tmp/ooda-credentials/.codex/config.toml");
    expect(write!.contents).toMatch(/model_provider = "cliproxy"/);
    expect(write!.contents).not.toContain("proxy-key");
    expect(prepared.environment).not.toHaveProperty("OPENAI_API_KEY");
  });

  it("falls back to host OAuth for a provider the proxy cannot serve", () => {
    const prepared = prepare("grok");
    expect(prepared.credentialSource).toBe("host_oauth");
    expect(prepared.credentialCopies).toEqual([
      {
        sourcePath: "/Users/operator/.grok/auth.json",
        destinationPath: "/tmp/ooda-credentials/.grok/auth.json",
      },
    ]);
    expect(prepared.environment).not.toHaveProperty("ANTHROPIC_BASE_URL");
  });

  it("falls back to host OAuth when the operator pins a provider to subscription", () => {
    const prepared = prepare("claude", { ...host, BOB_PROVIDER_AUTH_MODE_CLAUDE: "subscription" });
    expect(prepared.credentialSource).toBe("host_oauth");
    expect(prepared.credentialCopies).toHaveLength(1);
    expect(prepared.environment).not.toHaveProperty("ANTHROPIC_BASE_URL");
    expect(prepared.environment).not.toHaveProperty("ANTHROPIC_AUTH_TOKEN");
  });

  it("behaves exactly as before when no proxy route is configured", () => {
    const prepared = prepare("claude", { PATH: "/usr/bin", HOME: "/Users/operator" });
    expect(prepared.credentialSource).toBe("host_oauth");
    expect(prepared.credentialWrites).toEqual([]);
    expect(prepared.credentialCopies).toEqual([
      {
        sourcePath: "/Users/operator/.claude/.credentials.json",
        destinationPath: "/tmp/ooda-credentials/.claude/.credentials.json",
      },
    ]);
  });

  it("labels metered runs so the run record can say which credential served it", () => {
    const prepared = new SubscriptionRuntimeBroker().prepare({
      provider: "claude",
      jobClass: "comparison",
      capabilities: [],
      billingPolicy: "metered_allowed",
      authMode: "api_key",
      sandboxPath: "/tmp/ooda-job",
      source: { PATH: "/usr/bin", HOME: "/Users/operator", ANTHROPIC_API_KEY: "metered-key" },
    });
    expect(prepared.credentialSource).toBe("metered");
    expect(prepared.credentialWrites).toEqual([]);
  });
});
