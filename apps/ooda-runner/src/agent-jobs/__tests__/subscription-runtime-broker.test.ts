import { describe, expect, it } from "vitest";

import { SubscriptionRuntimeBroker } from "../subscription-runtime-broker";

describe("SubscriptionRuntimeBroker", () => {
  it("uses the official client account without passing metered or runner secrets", () => {
    const prepared = new SubscriptionRuntimeBroker().prepare({
      provider: "codex",
      jobClass: "read_only_research",
      capabilities: ["web.read"],
      billingPolicy: "subscription_only",
      authMode: "subscription",
      sandboxPath: "/tmp/ooda-job",
      source: {
        PATH: "/usr/bin",
        HOME: "/Users/operator",
        OPENAI_API_KEY: "metered-key",
        DATABASE_URL: "must-not-leak",
      },
    });

    expect(prepared).toMatchObject({
      authMode: "subscription",
      permissionMode: "skip",
      useOuterProcessSandbox: false,
      environment: {
        PATH: "/usr/bin",
        HOME: "/Users/operator",
        TMPDIR: "/tmp/ooda-job/.tmp",
      },
    });
    expect(prepared.environment).not.toHaveProperty("OPENAI_API_KEY");
    expect(prepared.environment).not.toHaveProperty("DATABASE_URL");
  });

  it("keeps Claude prompt-gated and derives a narrow tool allowlist", () => {
    const prepared = new SubscriptionRuntimeBroker().prepare({
      provider: "claude",
      jobClass: "opportunity_review",
      capabilities: ["project_context.read", "web.read", "scratch.read"],
      billingPolicy: "subscription_only",
      authMode: "subscription",
      sandboxPath: "/tmp/ooda-job",
      source: { PATH: "/usr/bin", HOME: "/Users/operator" },
    });
    expect(prepared.permissionMode).toBe("prompt");
    expect(prepared.allowedTools).toEqual([
      "Glob",
      "Grep",
      "Read",
      "WebFetch",
      "WebSearch",
    ]);
    expect(prepared.allowedTools).not.toContain("Bash");
  });

  it("rejects metered credentials unless policy explicitly permits them", () => {
    expect(() =>
      new SubscriptionRuntimeBroker().prepare({
        provider: "claude",
        jobClass: "comparison",
        capabilities: [],
        billingPolicy: "subscription_only",
        authMode: "api_key",
        sandboxPath: "/tmp/ooda-job",
        source: {
          PATH: "/usr/bin",
          HOME: "/Users/operator",
          ANTHROPIC_API_KEY: "metered-key",
        },
      }),
    ).toThrow(/metered_allowed/);
  });
});
