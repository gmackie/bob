import { describe, expect, it } from "vitest";

import { isInteresting, parseNumstat, rankTouched } from "./worktree-watch";

describe("isInteresting", () => {
  it("keeps source paths and drops noise dirs anywhere in the path", () => {
    expect(isInteresting("src/lib/streak.ts")).toBe(true);
    expect(isInteresting("apps/web/node_modules/x/index.js")).toBe(false);
    expect(isInteresting(".git/index")).toBe(false);
    expect(isInteresting("dist/bundle.js")).toBe(false);
    expect(isInteresting("src/a.ts.swp")).toBe(false);
    expect(isInteresting("../escape")).toBe(false);
    expect(isInteresting("")).toBe(false);
  });
});

describe("parseNumstat", () => {
  it("parses lines and treats binary markers as zero", () => {
    expect(parseNumstat("12\t3\tsrc/a.ts\n-\t-\tassets/logo.png\n\n")).toEqual([
      { path: "src/a.ts", added: 12, removed: 3 },
      { path: "assets/logo.png", added: 0, removed: 0 },
    ]);
  });
  it("handles paths with spaces", () => {
    expect(parseNumstat("1\t0\tdocs/my file.md")[0]?.path).toBe("docs/my file.md");
  });
});

describe("rankTouched", () => {
  it("orders by recency then frequency and caps the list", () => {
    const m = new Map([
      ["old.ts", { n: 9, last: 1 }],
      ["new.ts", { n: 1, last: 3 }],
      ["mid.ts", { n: 5, last: 2 }],
    ]);
    expect(rankTouched(m)).toEqual(["new.ts", "mid.ts", "old.ts"]);
    const big = new Map(Array.from({ length: 60 }, (_, i) => [`f${i}.ts`, { n: 1, last: i }]));
    expect(rankTouched(big)).toHaveLength(40);
  });
});
