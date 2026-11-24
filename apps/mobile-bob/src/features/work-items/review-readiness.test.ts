import { describe, expect, it } from "vitest";

import { describeReviewReadiness } from "./review-readiness";

describe("describeReviewReadiness", () => {
  it("warns when an item under review has nothing attached", () => {
    // The exact shape of the 3,116 items found in production: a run, a review
    // status, and no output whatsoever.
    const notice = describeReviewReadiness({
      status: "in_review",
      artifactCount: 0,
      commentCount: 0,
    });

    expect(notice?.title).toBe("Nothing to review yet");
    expect(notice?.detail).toMatch(/without attaching an artifact/i);
  });

  it("stays quiet once there is anything to look at", () => {
    expect(
      describeReviewReadiness({ status: "in_review", artifactCount: 1, commentCount: 0 }),
    ).toBeNull();
    expect(
      describeReviewReadiness({ status: "in_review", artifactCount: 0, commentCount: 1 }),
    ).toBeNull();
    expect(
      describeReviewReadiness({
        status: "in_review",
        artifactCount: 0,
        commentCount: 0,
        childCount: 2,
      }),
    ).toBeNull();
  });

  it("says nothing about items that are not asking for review", () => {
    for (const status of ["in_progress", "todo", "done", "failed", "cancelled"]) {
      expect(
        describeReviewReadiness({ status, artifactCount: 0, commentCount: 0 }),
      ).toBeNull();
    }
  });

  it("covers the other spellings of review the board uses", () => {
    for (const status of ["review", "review_ready"]) {
      expect(
        describeReviewReadiness({ status, artifactCount: 0, commentCount: 0 }),
      ).not.toBeNull();
    }
  });
});
