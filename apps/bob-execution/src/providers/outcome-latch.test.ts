/**
 * A run outcome can disqualify an agent in more than one way, and the UI has
 * to say which — otherwise an operator is told "Ready" about an agent that
 * cannot run, and has no idea what to do.
 *
 * On 2026-08-30 all four agents were failing, each differently, and the node
 * page reported three of them Ready:
 *
 *   claude  rate_limit — you've hit your weekly limit · resets 3pm (UTC)
 *   codex   401 Unauthorized
 *   cursor  Authentication required. Please run 'agent login' first
 *   grok    402 Payment Required
 *
 * Only grok showed correctly. `classifyRunFailure` already recognised the auth
 * cases, but the latch dropped everything that was not `no_credit`, so an
 * agent whose runs die on 401 kept probing as Ready.
 *
 * The remedies differ, which is the whole point: top up, sign in, or wait.
 */
import { describe, expect, it } from "vitest";

import { RunOutcomeLatch, classifyRunFailure } from "./credit.js";

describe("classifyRunFailure", () => {
  it("separates a rate limit from an exhausted balance", () => {
    // A weekly cap is temporary and needs waiting; credit needs money. Calling
    // either the other sends the operator at the wrong remedy.
    expect(
      classifyRunFailure({
        code: 1,
        stderr: "rate_limit | You've hit your weekly limit · resets 3pm (UTC)",
      }),
    ).toBe("rate_limited");
    expect(classifyRunFailure({ code: 1, stderr: "402 Payment Required" })).toBe("no_credit");
  });

  it("recognises each agent's real auth failure wording", () => {
    expect(
      classifyRunFailure({ code: 1, stderr: "Error: Authentication required. Please run 'agent login' first" }),
    ).toBe("auth");
    expect(
      classifyRunFailure({ code: 1, stderr: "failed to connect to websocket: HTTP error: 401 Unauthorized" }),
    ).toBe("auth");
  });
});

describe("RunOutcomeLatch", () => {
  it("latches an auth failure so a Ready probe cannot mask it", () => {
    const latch = new RunOutcomeLatch();
    latch.noteRunOutcome("cursor-agent", {
      code: 1,
      stderr: "Error: Authentication required. Please run 'agent login' first",
    });

    expect(latch.get("cursor-agent").kind).toBe("auth");
    expect(latch.get("cursor-agent").detail).toContain("Authentication required");
  });

  it("latches a rate limit distinctly from credit", () => {
    const latch = new RunOutcomeLatch();
    latch.noteRunOutcome("claude", {
      code: 1,
      stderr: "rate_limit | You've hit your weekly limit · resets 3pm (UTC)",
    });

    expect(latch.get("claude").kind).toBe("rate_limited");
  });

  it("still latches credit exhaustion", () => {
    const latch = new RunOutcomeLatch();
    latch.noteRunOutcome("grok", { code: 1, stderr: '"http_status": 402' });

    expect(latch.get("grok").kind).toBe("no_credit");
  });

  it("clears on a successful run", () => {
    const latch = new RunOutcomeLatch();
    latch.noteRunOutcome("grok", { code: 1, stderr: "402 Payment Required" });
    latch.noteRunOutcome("grok", { code: 0, stdout: "done" });

    expect(latch.get("grok").kind).toBeUndefined();
  });

  it("leaves an unrelated failure alone rather than guessing", () => {
    // A network blip must not be reported as a credential problem.
    const latch = new RunOutcomeLatch();
    latch.noteRunOutcome("codex", { code: 1, stderr: "ECONNRESET" });

    expect(latch.get("codex").kind).toBeUndefined();
  });

  it("does not let re-authentication clear an exhausted balance", () => {
    // Signing in again does not buy credit; clearing here is what made the UI
    // say "sign in" when it should say "top up".
    const latch = new RunOutcomeLatch();
    latch.noteRunOutcome("grok", { code: 1, stderr: "402 Payment Required" });
    latch.noteAuthSuccess("grok");

    expect(latch.get("grok").kind).toBe("no_credit");
  });

  it("does clear an auth latch once the operator signs in", () => {
    // Unlike credit, signing in IS the remedy for an auth latch.
    const latch = new RunOutcomeLatch();
    latch.noteRunOutcome("cursor-agent", { code: 1, stderr: "401 Unauthorized" });
    latch.noteAuthSuccess("cursor-agent");

    expect(latch.get("cursor-agent").kind).toBeUndefined();
  });
});
