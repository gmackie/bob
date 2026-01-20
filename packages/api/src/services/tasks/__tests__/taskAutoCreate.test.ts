import { describe, expect, it } from "vitest";

function extractLabelsFromBranch(branch: string): string[] {
  const labels: string[] = [];
  const lowerBranch = branch.toLowerCase();

  if (lowerBranch.includes("feature") || lowerBranch.includes("feat")) {
    labels.push("feature");
  }
  if (lowerBranch.includes("fix") || lowerBranch.includes("bug")) {
    labels.push("bug");
  }
  if (lowerBranch.includes("refactor")) {
    labels.push("refactor");
  }
  if (lowerBranch.includes("docs") || lowerBranch.includes("documentation")) {
    labels.push("documentation");
  }
  if (lowerBranch.includes("test")) {
    labels.push("testing");
  }
  if (lowerBranch.includes("chore") || lowerBranch.includes("maintenance")) {
    labels.push("maintenance");
  }

  return labels;
}

describe("taskAutoCreate helper functions", () => {
  describe("extractLabelsFromBranch", () => {
    it("should extract 'feature' label from feature branch", () => {
      expect(extractLabelsFromBranch("feature/add-auth")).toContain("feature");
      expect(extractLabelsFromBranch("feat/add-auth")).toContain("feature");
      expect(extractLabelsFromBranch("my-feature-branch")).toContain("feature");
    });

    it("should extract 'bug' label from fix/bug branch", () => {
      expect(extractLabelsFromBranch("fix/login-issue")).toContain("bug");
      expect(extractLabelsFromBranch("bugfix/crash")).toContain("bug");
      expect(extractLabelsFromBranch("bug/memory-leak")).toContain("bug");
    });

    it("should extract 'refactor' label from refactor branch", () => {
      expect(extractLabelsFromBranch("refactor/auth-module")).toContain(
        "refactor",
      );
      expect(extractLabelsFromBranch("code-refactor")).toContain("refactor");
    });

    it("should extract 'documentation' label from docs branch", () => {
      expect(extractLabelsFromBranch("docs/readme-update")).toContain(
        "documentation",
      );
      expect(extractLabelsFromBranch("documentation/api")).toContain(
        "documentation",
      );
    });

    it("should extract 'testing' label from test branch", () => {
      expect(extractLabelsFromBranch("test/unit-tests")).toContain("testing");
      expect(extractLabelsFromBranch("add-tests")).toContain("testing");
    });

    it("should extract 'maintenance' label from chore/maintenance branch", () => {
      expect(extractLabelsFromBranch("chore/update-deps")).toContain(
        "maintenance",
      );
      expect(extractLabelsFromBranch("maintenance/cleanup")).toContain(
        "maintenance",
      );
    });

    it("should extract multiple labels when applicable", () => {
      const labels = extractLabelsFromBranch("feature/fix-and-test");
      expect(labels).toContain("feature");
      expect(labels).toContain("bug");
      expect(labels).toContain("testing");
    });

    it("should return empty array for unrecognized branch", () => {
      const labels = extractLabelsFromBranch("some-random-branch");
      expect(labels).toEqual([]);
    });

    it("should be case-insensitive", () => {
      expect(extractLabelsFromBranch("FEATURE/ADD-AUTH")).toContain("feature");
      expect(extractLabelsFromBranch("FIX/BUG")).toContain("bug");
      expect(extractLabelsFromBranch("REFACTOR/CODE")).toContain("refactor");
    });

    it("should handle bob branch naming convention", () => {
      expect(extractLabelsFromBranch("bob/ABC-123/feature-auth")).toContain(
        "feature",
      );
      expect(extractLabelsFromBranch("bob/XYZ-456/fix-crash")).toContain("bug");
    });
  });

  describe("branch name patterns", () => {
    const testCases = [
      { branch: "feature/user-authentication", expected: ["feature"] },
      { branch: "feat/login", expected: ["feature"] },
      { branch: "fix/null-pointer", expected: ["bug"] },
      { branch: "bugfix/memory-leak", expected: ["bug"] },
      { branch: "hotfix/critical-bug", expected: ["bug"] },
      { branch: "refactor/clean-code", expected: ["refactor"] },
      { branch: "docs/api-reference", expected: ["documentation"] },
      { branch: "test/integration", expected: ["testing"] },
      { branch: "chore/deps", expected: ["maintenance"] },
      { branch: "main", expected: [] },
      { branch: "develop", expected: [] },
      { branch: "release/1.0.0", expected: [] },
    ];

    testCases.forEach(({ branch, expected }) => {
      it(`should extract ${expected.length > 0 ? expected.join(", ") : "no labels"} from "${branch}"`, () => {
        const labels = extractLabelsFromBranch(branch);
        expect(labels.sort()).toEqual(expected.sort());
      });
    });
  });
});
