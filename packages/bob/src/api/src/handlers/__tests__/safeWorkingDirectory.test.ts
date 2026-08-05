import { describe, expect, it } from "vitest";

import { safeWorkingDirectory } from "../publicApi.js";

// safeWorkingDirectory bounds where a dispatched agent may run. Dispatched runs
// execute with elevated permissions, so the working directory must stay under
// /home/bob/dev (where projects + scaffolds live) with no `..` escape. A bad
// value must degrade to undefined so the caller falls back to the safe default,
// never to an attacker-chosen path.
describe("safeWorkingDirectory", () => {
  it("returns undefined for undefined/empty", () => {
    expect(safeWorkingDirectory(undefined)).toBeUndefined();
    expect(safeWorkingDirectory("")).toBeUndefined();
    expect(safeWorkingDirectory("   ")).toBeUndefined();
  });

  it("allows paths under /home/bob/dev/", () => {
    expect(safeWorkingDirectory("/home/bob/dev/projects")).toBe(
      "/home/bob/dev/projects",
    );
    expect(safeWorkingDirectory("/home/bob/dev/projects/myapp")).toBe(
      "/home/bob/dev/projects/myapp",
    );
    expect(safeWorkingDirectory("/home/bob/dev/gmacko-bob")).toBe(
      "/home/bob/dev/gmacko-bob",
    );
  });

  it("trims surrounding whitespace before validating", () => {
    expect(safeWorkingDirectory("  /home/bob/dev/projects  ")).toBe(
      "/home/bob/dev/projects",
    );
  });

  it("rejects paths outside the allowed root", () => {
    for (const bad of [
      "/etc/passwd",
      "/root",
      "/home/bob", // parent of dev
      "/home/bob/dev", // the boundary itself (no trailing slash) is not "under" it
      "/home/bobby/dev/x", // prefix look-alike
      "relative/path",
      "~/dev/x",
    ]) {
      expect(safeWorkingDirectory(bad)).toBeUndefined();
    }
  });

  it("rejects traversal even under the allowed root", () => {
    for (const bad of [
      "/home/bob/dev/../../etc",
      "/home/bob/dev/projects/../../../root",
      "/home/bob/dev/..",
    ]) {
      expect(safeWorkingDirectory(bad)).toBeUndefined();
    }
  });
});
