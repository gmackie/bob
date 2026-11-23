import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";

import {
  generateBranchName,
  generateTrackerBranchName,
  isTrackerIdentifier,
  slugify,
  trackerIdentifierOf,
} from "./branch-name";

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
  it("admits colon-separated intake identities through Git without losing identity", () => {
    const identifier =
      "bizpulse:2026-10-05:startup-id:connector_failure:restore-connection";
    const branch = generateBranchName(identifier, "Restore connection");
    expect(
      execFileSync("git", ["check-ref-format", "--branch", branch], {
        encoding: "utf8",
      }).trim(),
    ).toBe(branch);
    expect(decodeURIComponent(branch.split("/")[1] ?? "")).toBe(identifier);
  });

  it("does not merge identities when escaping punctuation or Unicode", () => {
    const identifiers = [
      "a:b",
      "ab",
      "a-b",
      "a/b",
      "a%3Ab",
      "a.b",
      "a@{b}",
      "a b",
      "é",
      "日本語",
      "a\\b",
      "a\u0000b",
    ];
    const branches = identifiers.map((id) =>
      generateBranchName(id, "Same title"),
    );
    expect(new Set(branches).size).toBe(identifiers.length);
    for (const [index, branch] of branches.entries()) {
      expect(
        execFileSync("git", ["check-ref-format", "--branch", branch], {
          encoding: "utf8",
        }).trim(),
      ).toBe(branch);
      expect(decodeURIComponent(branch.split("/")[1] ?? "")).toBe(
        identifiers[index],
      );
      expect(generateBranchName(identifiers[index] ?? "", "Same title")).toBe(
        branch,
      );
      expect(
        execFileSync("git", ["check-ref-format", "--branch", `${branch}-a2`], {
          encoding: "utf8",
        }).trim(),
      ).toBe(`${branch}-a2`);
    }
  });

  it.each(["", "!!!", "日本語"])(
    "uses a nonempty branch component for title %j",
    (title) => {
      const branch = generateBranchName("work-item", title);
      expect(branch).toBe("bob/work-item/task");
      expect(
        execFileSync("git", ["check-ref-format", "--branch", branch], {
          encoding: "utf8",
        }).trim(),
      ).toBe(branch);
    },
  );

  it("refuses an absent identifier rather than sharing an anonymous branch", () => {
    expect(() => generateBranchName("", "Task")).toThrow("identifier");
  });

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

describe("tracker identifiers", () => {
  it.each(["", "bizpulse:date:item", "GMA-5/other", "GMA-5.lock", "gma-5", "GMA-5\n"])(
    "rejects invalid tracker identity %j at the emitter boundary",
    (identifier) => {
      expect(() => generateTrackerBranchName(identifier, "Task")).toThrow(
        "A valid tracker identifier is required for branch naming",
      );
    },
  );

  it("accepts exactly what Kanbanger's [A-Z]{2,10}-\\d+ extractor finds", () => {
    expect(isTrackerIdentifier("GMA-612")).toBe(true);
    expect(isTrackerIdentifier("gma-612")).toBe(false);
    expect(isTrackerIdentifier("1df6e8a9-d380-4fb9-8929-ee8700d2c0b4")).toBe(
      false,
    );
    expect(isTrackerIdentifier("81431962")).toBe(false);
    expect(isTrackerIdentifier(null)).toBe(false);
  });

  it("prefers the recorded identifier, then an identifier-keyed external id, then the URL", () => {
    expect(
      trackerIdentifierOf({
        externalProvider: "linear",
        externalId: "cb43f3bb-295f-42ca-9a95-a8ba4076e084",
        externalUrl: "https://tasks.gmac.io/gmacko/issue/GMA-714",
        sourceMetadata: { trackerIdentifier: "GMA-700" },
      }),
    ).toBe("GMA-700");
    expect(
      trackerIdentifierOf({ externalProvider: "linear", externalId: "GMA-5" }),
    ).toBe("GMA-5");
    expect(
      trackerIdentifierOf({
        externalProvider: "linear",
        externalId: "cb43f3bb-295f-42ca-9a95-a8ba4076e084",
        externalUrl: "https://tasks.gmac.io/gmacko/issue/GMA-714",
        sourceMetadata: {},
      }),
    ).toBe("GMA-714");
  });

  it("is null for internal items and for imports with no recoverable identifier", () => {
    expect(
      trackerIdentifierOf({ externalProvider: null, externalId: "GMA-5" }),
    ).toBeNull();
    expect(
      trackerIdentifierOf({
        externalProvider: "linear",
        externalId: "1df6e8a9-d380-4fb9-8929-ee8700d2c0b4",
      }),
    ).toBeNull();
  });

  it("builds bob/GMA-612-<slug>, keeping the identifier upper-case for Kanbanger's matcher", () => {
    expect(
      generateTrackerBranchName("GMA-612", "Fix the login redirect!"),
    ).toBe("bob/GMA-612-fix-the-login-redirect");
    expect(generateTrackerBranchName("GMA-612", "!!!")).toBe("bob/GMA-612");
    // The identifier survives verbatim, so Kanbanger finds it in the head ref.
    expect(
      /[A-Z]{2,10}-\d+/.exec(generateTrackerBranchName("GMA-612", "x"))?.[0],
    ).toBe("GMA-612");
  });
});
