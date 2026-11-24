import { describe, expect, it } from "vitest";

import { resolveCompletionOutcome } from "../review-evidence";

describe("resolveCompletionOutcome", () => {
  it("refuses to advance a run that produced nothing", () => {
    // The exact shape behind 3,116 production items marked "Review ready"
    // with nothing attached: a run ended, and that was the only signal.
    const outcome = resolveCompletionOutcome({
      artifactCount: 0,
      commentCount: 0,
    });

    expect(outcome.advance).toBe(false);
    if (outcome.advance) throw new Error("expected the run not to advance");
    expect(outcome.reason).toMatch(/without attaching/i);
  });

  it("advances on any evidence a person can act on", () => {
    for (const evidence of [
      { artifactCount: 1, commentCount: 0 },
      { artifactCount: 0, commentCount: 1 },
      { artifactCount: 0, commentCount: 0, hasPullRequest: true },
    ]) {
      expect(resolveCompletionOutcome(evidence)).toEqual({
        advance: true,
        status: "in_review",
      });
    }
  });

  it("treats a pull request as reviewable even with nothing attached here", () => {
    // The diff is the artifact in that case, and it lives in the forge.
    expect(
      resolveCompletionOutcome({
        artifactCount: 0,
        commentCount: 0,
        hasPullRequest: true,
      }).advance,
    ).toBe(true);
  });
});
