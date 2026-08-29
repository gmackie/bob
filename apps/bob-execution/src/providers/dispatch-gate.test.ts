import { describe, expect, it } from "vitest";

import { decideDispatch } from "./dispatch-gate.js";

const PREFERENCE = ["claude", "codex", "grok"] as const;

describe("decideDispatch", () => {
  it("picks the first ready agent in preference order", () => {
    const decision = decideDispatch(PREFERENCE, [
      { name: "claude", status: "unauthenticated" },
      { name: "codex", status: "ready" },
      { name: "grok", status: "ready" },
    ]);

    expect(decision).toMatchObject({ agent: "codex", paused: false });
  });

  it("pauses dispatch when every agent is confirmed dead — the 2026-08-29 state", () => {
    // claude auth_needed, codex auth_expired, grok authenticated but 402.
    // Today this returns AGENT_PREFERENCE[0] and burns the backlog.
    const decision = decideDispatch(PREFERENCE, [
      { name: "claude", status: "unauthenticated" },
      { name: "codex", status: "unauthenticated" },
      { name: "grok", status: "no_credit", detail: "402 Payment Required" },
    ]);

    expect(decision.paused).toBe(true);
    expect(decision.agent).toBeNull();
    expect(decision.blocked).toHaveLength(3);
  });

  it("treats a missing CLI as confirmed dead", () => {
    const decision = decideDispatch(["claude"], [{ name: "claude", status: "unavailable" }]);
    expect(decision.paused).toBe(true);
  });

  it("NEVER pauses on uncertain evidence — this is the load-bearing rule", () => {
    // agentHealthRouter.ts documents, deliberately, that a broken health check
    // must not stop dispatch entirely. Only confirmed evidence may halt; an
    // unrecognised or errored status must fall through to a real attempt.
    const decision = decideDispatch(PREFERENCE, [
      { name: "claude", status: "degraded" },
      { name: "codex", status: "probe_failed" },
      { name: "grok", status: "something_new_from_a_future_cli" },
    ]);

    expect(decision.paused).toBe(false);
    expect(decision.agent).toBe("claude");
  });

  it("prefers a ready agent over an uncertain one", () => {
    const decision = decideDispatch(PREFERENCE, [
      { name: "claude", status: "degraded" },
      { name: "codex", status: "ready" },
    ]);

    expect(decision.agent).toBe("codex");
  });

  it("falls through to an uncertain agent when nothing is ready", () => {
    const decision = decideDispatch(PREFERENCE, [
      { name: "claude", status: "unauthenticated" },
      { name: "codex", status: "degraded" },
    ]);

    expect(decision).toMatchObject({ agent: "codex", paused: false });
  });

  it("does not pause when the report is empty — absence of evidence is not evidence", () => {
    const decision = decideDispatch(PREFERENCE, []);
    expect(decision.paused).toBe(false);
    expect(decision.agent).toBe("claude");
  });

  it("honours the manual override even when everything is confirmed dead", () => {
    const decision = decideDispatch(
      PREFERENCE,
      [
        { name: "claude", status: "unauthenticated" },
        { name: "codex", status: "no_credit" },
        { name: "grok", status: "no_credit" },
      ],
      { override: true },
    );

    expect(decision.paused).toBe(false);
    expect(decision.agent).toBe("claude");
    expect(decision.reason).toMatch(/override/i);
  });

  it("reports why it paused, using the provider's own wording", () => {
    const decision = decideDispatch(["grok"], [
      { name: "grok", status: "no_credit", detail: "402 Payment Required — balance exhausted" },
    ]);

    expect(decision.reason).toContain("grok");
    expect(decision.blocked[0]).toMatchObject({
      agent: "grok",
      status: "no_credit",
      detail: "402 Payment Required — balance exhausted",
    });
  });

  it("ignores agents absent from the preference list", () => {
    const decision = decideDispatch(["claude"], [
      { name: "claude", status: "unauthenticated" },
      { name: "grok", status: "ready" },
    ]);

    expect(decision.paused).toBe(true);
  });

  it("distinguishes remediation: no_credit needs top-up, not sign-in", () => {
    const decision = decideDispatch(["grok"], [{ name: "grok", status: "no_credit" }]);
    expect(decision.blocked[0]?.remedy).toBe("top_up");

    const other = decideDispatch(["claude"], [{ name: "claude", status: "unauthenticated" }]);
    expect(other.blocked[0]?.remedy).toBe("sign_in");
  });

  it("marks an uninstalled CLI as needing neither sign-in nor top-up", () => {
    const decision = decideDispatch(["claude"], [{ name: "claude", status: "unavailable" }]);
    expect(decision.blocked[0]?.remedy).toBe("install");
  });
});
