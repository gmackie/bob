import { describe, expect, it } from "vitest";

import { generateBranchName, slugify } from "./branch-name";

// Golden reference for the historical taskExecutor slug rules. apps/bob-execution
// taskExecutor now imports generateBranchName from this package (single source of
// truth), so these assertions pin the shape both dispatch paths produce and guard
// against anyone silently changing the slug rules out from under the executor.
function refSlugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .replace(/[\s_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50);
}
function refBranch(identifier: string, title: string): string {
  return `bob/${identifier}/${refSlugify(title)}`;
}

describe("slugify", () => {
  it("lower-cases, strips punctuation, and hyphenates whitespace", () => {
    expect(slugify("Add Reusable Prospect Onboarding!")).toBe(
      "add-reusable-prospect-onboarding",
    );
  });

  it("collapses runs of spaces/underscores/hyphens into one hyphen", () => {
    expect(slugify("a   b__c--d")).toBe("a-b-c-d");
  });

  it("trims leading/trailing separators", () => {
    expect(slugify("  -- hello --  ")).toBe("hello");
  });

  it("truncates to 50 characters", () => {
    const long = "word ".repeat(40);
    expect(slugify(long).length).toBeLessThanOrEqual(50);
  });
});

describe("generateBranchName", () => {
  it("builds bob/<identifier>/<slug>", () => {
    expect(generateBranchName("1a2b3c4d", "Fix the login bug")).toBe(
      "bob/1a2b3c4d/fix-the-login-bug",
    );
  });

  it("matches the taskExecutor reference for varied inputs", () => {
    const cases: [string, string][] = [
      ["1a2b3c4d", "Add reusable prospect onboarding blueprints"],
      ["BOB-27", "Operationalize contract billing & success lifecycle!!!"],
      ["deadbeef", "   spaced___out---title   "],
      ["cafef00d", "UPPER CASE Title With Números 123"],
    ];
    for (const [identifier, title] of cases) {
      expect(generateBranchName(identifier, title)).toBe(
        refBranch(identifier, title),
      );
    }
  });
});
