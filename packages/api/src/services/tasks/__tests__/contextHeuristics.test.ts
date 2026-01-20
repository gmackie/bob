import { describe, expect, it } from "vitest";

import type { ContextInput, DiffStats } from "../contextHeuristics";
import {
  evaluateContextReadiness,
  isContextReady,
  parseDiffStats,
} from "../contextHeuristics";

function createMockRepository(overrides = {}) {
  return {
    id: "repo-1",
    userId: "user-1",
    name: "test-repo",
    path: "/path/to/repo",
    branch: "main",
    mainBranch: "main",
    remoteUrl: null,
    remoteProvider: null,
    remoteOwner: null,
    remoteName: null,
    remoteInstanceUrl: null,
    gitProviderConnectionId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function createMockPullRequest(overrides = {}) {
  return {
    id: "pr-1",
    userId: "user-1",
    repositoryId: "repo-1",
    gitProviderConnectionId: null,
    provider: "github" as const,
    instanceUrl: null,
    remoteOwner: "org",
    remoteName: "repo",
    number: 42,
    headBranch: "feature/test",
    baseBranch: "main",
    title: "Add user authentication feature",
    body: "- Added login\n- Added logout",
    status: "open" as const,
    url: "https://github.com/org/repo/pull/42",
    sessionId: null,
    kanbangerTaskId: null,
    additions: 100,
    deletions: 20,
    changedFiles: 5,
    createdAt: new Date(),
    updatedAt: new Date(),
    mergedAt: null,
    closedAt: null,
    ...overrides,
  };
}

function createContextInput(
  overrides: Partial<ContextInput> = {},
): ContextInput {
  return {
    repository: createMockRepository(),
    branch: "feature/test",
    diffStats: { additions: 50, deletions: 10, filesChanged: 3 },
    pullRequest: createMockPullRequest(),
    isFirstPush: false,
    title: "Add user authentication service",
    summary: "- Added login endpoint\n- Added logout endpoint\n- Added tests",
    ...overrides,
  };
}

describe("contextHeuristics", () => {
  describe("evaluateContextReadiness - Hard Requirements Gate", () => {
    it("should fail when repository is missing", () => {
      const input = createContextInput({ repository: null });
      const result = evaluateContextReadiness(input);

      expect(result.ready).toBe(false);
      expect(result.gates.hardRequirements.passed).toBe(false);
      expect(result.gates.hardRequirements.reason).toContain("No repository");
    });

    it("should fail when branch is missing", () => {
      const input = createContextInput({ branch: null });
      const result = evaluateContextReadiness(input);

      expect(result.ready).toBe(false);
      expect(result.gates.hardRequirements.passed).toBe(false);
      expect(result.gates.hardRequirements.reason).toContain("No branch");
    });

    it("should fail when diffStats is missing", () => {
      const input = createContextInput({ diffStats: null });
      const result = evaluateContextReadiness(input);

      expect(result.ready).toBe(false);
      expect(result.gates.hardRequirements.passed).toBe(false);
      expect(result.gates.hardRequirements.reason).toContain(
        "No diff statistics",
      );
    });

    it("should fail when diff is too small (low LOC and few files)", () => {
      const input = createContextInput({
        diffStats: { additions: 5, deletions: 2, filesChanged: 1 },
      });
      const result = evaluateContextReadiness(input);

      expect(result.ready).toBe(false);
      expect(result.gates.hardRequirements.passed).toBe(false);
      expect(result.gates.hardRequirements.reason).toContain("too small");
    });

    it("should pass when LOC threshold is met", () => {
      const input = createContextInput({
        diffStats: { additions: 15, deletions: 10, filesChanged: 1 },
      });
      const result = evaluateContextReadiness(input);

      expect(result.gates.hardRequirements.passed).toBe(true);
    });

    it("should pass when file threshold is met", () => {
      const input = createContextInput({
        diffStats: { additions: 5, deletions: 2, filesChanged: 3 },
      });
      const result = evaluateContextReadiness(input);

      expect(result.gates.hardRequirements.passed).toBe(true);
    });
  });

  describe("evaluateContextReadiness - Lifecycle Gate", () => {
    it("should pass when PR exists", () => {
      const input = createContextInput({
        pullRequest: createMockPullRequest(),
        isFirstPush: false,
      });
      const result = evaluateContextReadiness(input);

      expect(result.gates.lifecycle.passed).toBe(true);
      expect(result.gates.lifecycle.reason).toContain("Pull request exists");
    });

    it("should pass when isFirstPush is true", () => {
      const input = createContextInput({
        pullRequest: null,
        isFirstPush: true,
      });
      const result = evaluateContextReadiness(input);

      expect(result.gates.lifecycle.passed).toBe(true);
      expect(result.gates.lifecycle.reason).toContain("First push");
    });

    it("should fail when no PR and not first push", () => {
      const input = createContextInput({
        pullRequest: null,
        isFirstPush: false,
      });
      const result = evaluateContextReadiness(input);

      expect(result.gates.lifecycle.passed).toBe(false);
      expect(result.gates.lifecycle.reason).toContain("No lifecycle signal");
    });
  });

  describe("evaluateContextReadiness - Quality Gate", () => {
    it("should pass with good title and summary", () => {
      const input = createContextInput({
        title: "Add user authentication service",
        summary: "- Added login endpoint\n- Added logout endpoint",
      });
      const result = evaluateContextReadiness(input);

      expect(result.gates.quality.passed).toBe(true);
    });

    it("should fail with generic title that has no action verbs", () => {
      // These generic titles have no action verbs, so they fail quality check
      // (generic: -30, no domain noun: -15, no action verb: -15 = score 40 < 50)
      const genericTitles = ["WIP", "work in progress", "Draft", "temp"];

      for (const title of genericTitles) {
        const input = createContextInput({ title });
        const result = evaluateContextReadiness(input);

        expect(result.gates.quality.passed).toBe(false);
        expect(result.gates.quality.details).toHaveProperty("issues");
      }
    });

    it("should pass generic titles that contain action verbs", () => {
      // "Fix" and "Update" are generic but also contain action verbs
      // So they only lose: generic -30, no domain -15 = score 55 >= 50 (passes)
      const genericWithVerbs = ["Fix", "Update"];

      for (const title of genericWithVerbs) {
        const input = createContextInput({ title });
        const result = evaluateContextReadiness(input);

        // These pass because the action verb offsets the generic penalty
        expect(result.gates.quality.passed).toBe(true);
        // But they still have issues flagged
        expect(result.gates.quality.details).toHaveProperty("issues");
      }
    });

    it("should penalize title lacking domain nouns", () => {
      const input = createContextInput({
        title: "Do something important",
      });
      const result = evaluateContextReadiness(input);

      const details = result.gates.quality.details as { issues?: string[] };
      expect(details.issues?.some((i) => i.includes("domain"))).toBe(true);
    });

    it("should penalize title lacking action verbs", () => {
      const input = createContextInput({
        title: "User authentication service",
      });
      const result = evaluateContextReadiness(input);

      const details = result.gates.quality.details as { issues?: string[] };
      expect(details.issues?.some((i) => i.includes("action verb"))).toBe(true);
    });

    it("should pass when no title provided but has good summary", () => {
      // No title: -40 (score 60), but with good summary (3+ bullets), no additional penalty
      // Score 60 >= 50, so it passes (barely)
      const input = createContextInput({ title: null });
      const result = evaluateContextReadiness(input);

      // Score is 60 which passes the 50 threshold
      expect(result.gates.quality.passed).toBe(true);
      // But issues are still recorded
      const details = result.gates.quality.details as { issues?: string[] };
      expect(details.issues).toContain("No title provided");
    });

    it("should fail when no title and poor summary", () => {
      // No title: -40 + poor summary: -20 = score 40 < 50
      const input = createContextInput({ title: null, summary: "no bullets" });
      const result = evaluateContextReadiness(input);

      expect(result.gates.quality.passed).toBe(false);
    });

    it("should penalize when summary has insufficient bullets", () => {
      const input = createContextInput({
        summary: "Just one change",
      });
      const result = evaluateContextReadiness(input);

      const details = result.gates.quality.details as { bulletCount?: number };
      expect(details.bulletCount).toBe(0);
    });

    it("should count various bullet formats", () => {
      const summaryWithBullets = `
- First item
* Second item
+ Third item
1. Fourth item
2. Fifth item
`;
      const input = createContextInput({ summary: summaryWithBullets });
      const result = evaluateContextReadiness(input);

      const details = result.gates.quality.details as { bulletCount?: number };
      expect(details.bulletCount).toBeGreaterThanOrEqual(5);
    });
  });

  describe("evaluateContextReadiness - Overall", () => {
    it("should be ready when all gates pass", () => {
      const input = createContextInput();
      const result = evaluateContextReadiness(input);

      expect(result.ready).toBe(true);
      expect(result.score).toBe(100);
      expect(result.gates.hardRequirements.passed).toBe(true);
      expect(result.gates.lifecycle.passed).toBe(true);
      expect(result.gates.quality.passed).toBe(true);
    });

    it("should not be ready when any gate fails", () => {
      const input = createContextInput({ repository: null });
      const result = evaluateContextReadiness(input);

      expect(result.ready).toBe(false);
      expect(result.score).toBeLessThan(100);
    });

    it("should provide suggestions for failed gates", () => {
      const input = createContextInput({
        repository: null,
        branch: null,
        title: "WIP",
      });
      const result = evaluateContextReadiness(input);

      expect(result.suggestions.length).toBeGreaterThan(0);
    });

    it("should dedupe suggestions", () => {
      const input = createContextInput({ title: "wip" });
      const result = evaluateContextReadiness(input);

      const uniqueSuggestions = [...new Set(result.suggestions)];
      expect(result.suggestions.length).toBe(uniqueSuggestions.length);
    });
  });

  describe("isContextReady - Quick Check", () => {
    it("should return true for valid context", () => {
      const input = createContextInput();
      expect(isContextReady(input)).toBe(true);
    });

    it("should return false for missing repository", () => {
      const input = createContextInput({ repository: null });
      expect(isContextReady(input)).toBe(false);
    });

    it("should return false for missing branch", () => {
      const input = createContextInput({ branch: null });
      expect(isContextReady(input)).toBe(false);
    });

    it("should return false for missing diffStats", () => {
      const input = createContextInput({ diffStats: null });
      expect(isContextReady(input)).toBe(false);
    });

    it("should return false for small diff", () => {
      const input = createContextInput({
        diffStats: { additions: 1, deletions: 0, filesChanged: 1 },
      });
      expect(isContextReady(input)).toBe(false);
    });

    it("should return false for generic title", () => {
      const input = createContextInput({ title: "WIP" });
      expect(isContextReady(input)).toBe(false);
    });

    it("should return false for no lifecycle signal", () => {
      const input = createContextInput({
        pullRequest: null,
        isFirstPush: false,
      });
      expect(isContextReady(input)).toBe(false);
    });
  });

  describe("parseDiffStats", () => {
    it("should parse git diff --stat output", () => {
      const output = "3 files changed, 42 insertions(+), 8 deletions(-)";
      const result = parseDiffStats(output);

      expect(result).toEqual({
        filesChanged: 3,
        additions: 42,
        deletions: 8,
      });
    });

    it("should parse single file change", () => {
      const output = "1 file changed, 10 insertions(+)";
      const result = parseDiffStats(output);

      expect(result).toEqual({
        filesChanged: 1,
        additions: 10,
        deletions: 0,
      });
    });

    it("should parse deletions only", () => {
      const output = "2 files changed, 5 deletions(-)";
      const result = parseDiffStats(output);

      expect(result).toEqual({
        filesChanged: 2,
        additions: 0,
        deletions: 5,
      });
    });

    it("should parse object format (GitHub API)", () => {
      const input = { additions: 100, deletions: 50, changed_files: 10 };
      const result = parseDiffStats(input);

      expect(result).toEqual({
        additions: 100,
        deletions: 50,
        filesChanged: 10,
      });
    });

    it("should handle partial object", () => {
      const input = { additions: 100 };
      const result = parseDiffStats(input);

      expect(result).toEqual({
        additions: 100,
        deletions: 0,
        filesChanged: 0,
      });
    });

    it("should return null for null input", () => {
      expect(parseDiffStats(null)).toBeNull();
    });

    it("should return null for empty string (treated as falsy)", () => {
      // Empty string is falsy in JS, so parseDiffStats returns null
      expect(parseDiffStats("")).toBeNull();
    });

    it("should handle unparseable string", () => {
      // String that doesn't match git diff format returns zeros
      const result = parseDiffStats("no matches here");
      expect(result).toEqual({
        filesChanged: 0,
        additions: 0,
        deletions: 0,
      });
    });
  });
});
