import { describe, expect, it } from "vitest";

import { buildRepoLayout, hash01, touchFingerprints } from "./spectacle-model";

describe("buildRepoLayout", () => {
  it("builds one node per path segment plus the root", () => {
    const nodes = buildRepoLayout(["src/api/users.ts", "src/api/posts.ts", "README.md"]);
    expect([...nodes.keys()].sort()).toEqual(["", "README.md", "src", "src/api", "src/api/posts.ts", "src/api/users.ts"]);
    expect(nodes.get("src")!.isFile).toBe(false);
    expect(nodes.get("src/api/users.ts")!.isFile).toBe(true);
    expect(nodes.get("src/api/users.ts")!.parent).toBe("src/api");
    expect(nodes.get("README.md")!.depth).toBe(1);
  });

  it("is deterministic — same paths, same coordinates", () => {
    const a = buildRepoLayout(["a/b/c.ts", "a/d.ts"]);
    const b = buildRepoLayout(["a/b/c.ts", "a/d.ts"]);
    for (const [path, node] of a) {
      expect(b.get(path)!.x).toBe(node.x);
      expect(b.get(path)!.y).toBe(node.y);
    }
  });

  it("keeps existing nodes stable when new paths arrive", () => {
    const before = buildRepoLayout(["src/a.ts"]);
    const after = buildRepoLayout(["src/a.ts", "src/deep/new.ts"]);
    expect(after.get("src/a.ts")!.x).toBe(before.get("src/a.ts")!.x);
    expect(after.get("src")!.y).toBe(before.get("src")!.y);
  });

  it("children sit near their parent, not across the canvas", () => {
    const nodes = buildRepoLayout(["pkg/lib/deep/leaf.ts"]);
    const parent = nodes.get("pkg/lib/deep")!;
    const leaf = nodes.get("pkg/lib/deep/leaf.ts")!;
    const dist = Math.hypot(leaf.x - parent.x, leaf.y - parent.y);
    expect(dist).toBeGreaterThan(0);
    expect(dist).toBeLessThan(0.3);
  });

  it("upgrades a directory to a file when the same path appears as a leaf", () => {
    const nodes = buildRepoLayout(["tools/gen/out.ts", "tools/gen"]);
    expect(nodes.get("tools/gen")!.isFile).toBe(true);
  });

  it("caps the number of file paths consumed", () => {
    const paths = Array.from({ length: 200 }, (_, i) => `f${i}.ts`);
    const nodes = buildRepoLayout(paths, 50);
    expect(nodes.size).toBe(51); // 50 files + root
  });
});

describe("hash01", () => {
  it("stays in [0, 1) and differs across names", () => {
    const values = ["a", "b", "src/x.ts", "src/y.ts"].map(hash01);
    for (const v of values) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
    expect(new Set(values).size).toBe(values.length);
  });
});

describe("touchFingerprints", () => {
  it("changes when a file's added/removed counts change", () => {
    const a = touchFingerprints([{ path: "x.ts", added: 3, removed: 1 }]);
    const b = touchFingerprints([{ path: "x.ts", added: 4, removed: 1 }]);
    expect(a.get("x.ts")).not.toBe(b.get("x.ts"));
  });
});
