import { describe, expect, it } from "vitest";

import { CreditLatch, classifyRunFailure, redactDetail } from "./credit.js";

describe("classifyRunFailure", () => {
  it("classifies the grok 402 that went undetected for eight days", () => {
    expect(
      classifyRunFailure({
        code: 1,
        stderr: "402 Payment Required — Grok Build usage balance exhausted",
      }),
    ).toBe("no_credit");
  });

  it.each([
    ["anthropic credit balance", "Your credit balance is too low to access the API"],
    ["openai quota", "You exceeded your current quota (insufficient_quota)"],
    ["plain out of credits", "Error: out of credits"],
    ["billing wording", "Billing issue: please add a payment method"],
  ])("classifies %s as no_credit", (_label, stderr) => {
    expect(classifyRunFailure({ code: 1, stderr })).toBe("no_credit");
  });

  it.each([
    ["revoked token", "OAuth token revoked — re-login required"],
    ["expired session", "OAuth session expired and could not be refreshed"],
    ["401", "401 Unauthorized"],
    ["not logged in", "You are not logged in. Run `claude login`."],
  ])("classifies %s as auth", (_label, stderr) => {
    expect(classifyRunFailure({ code: 1, stderr })).toBe("auth");
  });

  it("does NOT treat a rate limit as no_credit", () => {
    // Latching no_credit on a rate limit would strand a healthy agent behind a
    // "Top up" button that fixes nothing. Since 2026-08-30 it is reported as
    // its own kind rather than swallowed: claude's weekly cap blocks dispatch
    // just as hard as a dead credential, and reporting "Ready" through it left
    // 20 runs failing against agents the node page called healthy.
    expect(
      classifyRunFailure({ code: 1, stderr: "429 Too Many Requests: rate limit exceeded" }),
    ).toBe("rate_limited");
  });

  it("treats an ordinary non-zero exit as other", () => {
    expect(classifyRunFailure({ code: 1, stderr: "TypeError: undefined is not a function" })).toBe(
      "other",
    );
  });

  it("reads stdout as well as stderr", () => {
    expect(classifyRunFailure({ code: 1, stdout: "402 Payment Required" })).toBe("no_credit");
  });

  it("never classifies a successful run as a failure", () => {
    expect(classifyRunFailure({ code: 0, stderr: "402 Payment Required" })).toBe("other");
  });
});

describe("redactDetail", () => {
  it("keeps the provider's own wording so the operator sees the real problem", () => {
    expect(redactDetail("402 Payment Required — usage balance exhausted")).toBe(
      "402 Payment Required — usage balance exhausted",
    );
  });

  it("redacts anything token-shaped", () => {
    const out = redactDetail("failed with key sk-ant-api03-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA");
    expect(out).not.toContain("AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA");
    expect(out).toContain("[redacted]");
  });

  it("redacts bearer tokens", () => {
    expect(redactDetail("Authorization: Bearer abcdef123456789012345678")).toContain("[redacted]");
  });

  it("truncates runaway output", () => {
    expect(redactDetail("x".repeat(1000)).length).toBeLessThanOrEqual(300);
  });

  it("collapses whitespace to a single line", () => {
    expect(redactDetail("line one\n\n  line two\t")).toBe("line one line two");
  });
});

describe("CreditLatch", () => {
  it("latches on a credit failure and reports the provider's own wording", () => {
    const latch = new CreditLatch();
    latch.noteRunOutcome("grok", {
      code: 1,
      stderr: "402 Payment Required — Grok Build usage balance exhausted",
    });

    expect(latch.isLatched("grok")).toBe(true);
    expect(latch.detail("grok")).toContain("usage balance exhausted");
  });

  it("clears ONLY on a successful run", () => {
    const latch = new CreditLatch();
    latch.noteRunOutcome("grok", { code: 1, stderr: "402 Payment Required" });
    expect(latch.isLatched("grok")).toBe(true);

    latch.noteRunOutcome("grok", { code: 0, stdout: "done" });
    expect(latch.isLatched("grok")).toBe(false);
  });

  it("is NOT cleared by re-authentication — re-auth does not buy credit", () => {
    const latch = new CreditLatch();
    latch.noteRunOutcome("grok", { code: 1, stderr: "402 Payment Required" });

    latch.noteAuthSuccess("grok");

    expect(latch.isLatched("grok")).toBe(true);
  });

  it("is not disturbed by unrelated failures while latched", () => {
    const latch = new CreditLatch();
    latch.noteRunOutcome("grok", { code: 1, stderr: "402 Payment Required" });
    latch.noteRunOutcome("grok", { code: 1, stderr: "network timeout" });

    expect(latch.isLatched("grok")).toBe(true);
  });

  it("tracks providers independently", () => {
    const latch = new CreditLatch();
    latch.noteRunOutcome("grok", { code: 1, stderr: "402 Payment Required" });

    expect(latch.isLatched("grok")).toBe(true);
    expect(latch.isLatched("claude")).toBe(false);
  });

  it("latches auth failures, because the probe demonstrably misses them", () => {
    // Changed 2026-08-30. This used to expect no latch, on the theory that
    // auth was the probe's job. It is not reliable at it: codex probed Ready
    // while every run died on `401 Unauthorized`, and cursor probed Ready
    // while every run died on "Authentication required". A run outcome is
    // proof; the probe is an estimate.
    const latch = new CreditLatch();
    latch.noteRunOutcome("codex", { code: 1, stderr: "OAuth token revoked — re-login required" });

    expect(latch.get("codex").kind).toBe("auth");
  });
});

describe("redactDetail — account identifiers", () => {
  it("redacts email addresses so probe output cannot leak an account", () => {
    expect(redactDetail("not signed in as secret@example.com")).not.toContain("secret@example.com");
  });
});
