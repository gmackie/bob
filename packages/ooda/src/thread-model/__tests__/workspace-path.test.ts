import { describe, expect, it } from "vitest";
import { mkdtempSync, symlinkSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  resolveThreadPath,
  validatePathUnderRoot,
  WorkspacePathError,
} from "../workspace-path";

describe("resolveThreadPath", () => {
  it("builds path from storage root and slug", () => {
    const root = mkdtempSync(join(tmpdir(), "ooda-path-"));
    try {
      const path = resolveThreadPath(root, "improve-sleep");
      expect(path).toBe(join(root, "improve-sleep"));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects slugs with path traversal", () => {
    const root = mkdtempSync(join(tmpdir(), "ooda-path-"));
    try {
      expect(() =>
        resolveThreadPath(root, "../etc/passwd"),
      ).toThrow(WorkspacePathError);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects slugs with slashes", () => {
    const root = mkdtempSync(join(tmpdir(), "ooda-path-"));
    try {
      expect(() =>
        resolveThreadPath(root, "foo/bar"),
      ).toThrow(WorkspacePathError);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("throws a clear error when storage root does not exist", () => {
    expect(() =>
      resolveThreadPath("/nonexistent/path/that/does/not/exist", "my-thread"),
    ).toThrow(WorkspacePathError);
    expect(() =>
      resolveThreadPath("/nonexistent/path/that/does/not/exist", "my-thread"),
    ).toThrow("Storage root does not exist");
  });
});

describe("validatePathUnderRoot", () => {
  it("accepts a path directly under the root", async () => {
    const root = mkdtempSync(join(tmpdir(), "ooda-path-"));
    const threadDir = join(root, "my-thread");
    mkdirSync(threadDir, { recursive: true });

    await expect(
      validatePathUnderRoot(root, threadDir),
    ).resolves.not.toThrow();

    rmSync(root, { recursive: true, force: true });
  });

  it("rejects a symlink that escapes the root", async () => {
    const root = mkdtempSync(join(tmpdir(), "ooda-path-"));
    const outside = mkdtempSync(join(tmpdir(), "ooda-outside-"));
    const linkPath = join(root, "escape");
    symlinkSync(outside, linkPath);

    await expect(
      validatePathUnderRoot(root, linkPath),
    ).rejects.toThrow(WorkspacePathError);

    rmSync(root, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  });
});
