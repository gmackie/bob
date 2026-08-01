import { describe, it, expect } from "vitest";

import { isAuthError } from "../autoMergeReview";

// Regression guard for the 2026-07-29 silent dead-loop: a revoked shared Forgejo
// token made every PR 401, but each 401 was counted as an ordinary "skip", so
// the [auto-merge] counters looked healthy while the pipeline was fully dead for
// ~23h. isAuthError is what now separates a token-wide auth failure (escalated)
// from per-PR noise (ignored) — a false negative here reintroduces the outage.
describe("isAuthError", () => {
  it("matches the exact Forgejo revoked-token error from the incident", () => {
    const err = new Error(
      'Gitea API error (401): {"message":"access token does not exist [sha: fc24d9ef44fab0500150e782a7d8c121c689f6f8]"}',
    );
    expect(isAuthError(err)).toBe(true);
  });

  it("matches generic 401/403 and credential-shaped messages", () => {
    expect(isAuthError(new Error("Request failed with status 403"))).toBe(true);
    expect(
      isAuthError(new Error("remote: Credentials are incorrect or have expired.")),
    ).toBe(true);
    expect(isAuthError(new Error("401 Unauthorized"))).toBe(true);
    expect(isAuthError("HTTP (403) forbidden")).toBe(true);
  });

  it("is case-insensitive", () => {
    expect(isAuthError(new Error("ACCESS TOKEN DOES NOT EXIST"))).toBe(true);
    expect(isAuthError(new Error("UNAUTHORIZED"))).toBe(true);
  });

  it("does NOT match ordinary per-PR failures (no false page)", () => {
    expect(isAuthError(new Error("merge conflict in src/index.ts"))).toBe(false);
    expect(isAuthError(new Error("Gitea API error (404): not found"))).toBe(false);
    expect(isAuthError(new Error("Gitea API error (500): internal error"))).toBe(
      false,
    );
    expect(isAuthError(new Error("CI status pending"))).toBe(false);
    expect(isAuthError(new Error("ECONNRESET"))).toBe(false);
    expect(isAuthError(undefined)).toBe(false);
  });
});
