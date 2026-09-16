import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createExecutionBranch } from "./executionBranch";

describe("normal dispatch execution branches", () => {
  it("creates separate worktrees without replacing existing item refs", () => {
    const dir = mkdtempSync(join(tmpdir(), "bob-execution-branch-"));
    const git = (...args: string[]) => execFileSync("git", ["-C", dir, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
    try {
      git("init", "--quiet");
      git("-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "--allow-empty", "-m", "fixture");
      const original = git("rev-parse", "HEAD");
      const child = "bob/1df6e8a9-d380-4fb9-8929-ee8700d2c0b4/clone-integration-smoke-test-safe-to-delete";
      const bare = "bob/another-imported-item";
      git("branch", child);
      git("branch", bare);
      expect(() => git("branch", "bob/1df6e8a9-d380-4fb9-8929-ee8700d2c0b4")).toThrow();
      const first = createExecutionBranch("Clone integration smoke test — safe to delete");
      const second = createExecutionBranch("Clone integration smoke test — safe to delete");
      expect(first).not.toBe(second);
      for (const [index, branch] of [first, second].entries()) {
        git("check-ref-format", "--branch", branch);
        git("worktree", "add", "-b", branch, join(dir, `attempt-${index}`), "HEAD");
      }
      expect(git("rev-parse", child)).toBe(original);
      expect(git("rev-parse", bare)).toBe(original);
      expect(git("worktree", "list", "--porcelain")).toContain(`branch refs/heads/${first}`);
      expect(git("worktree", "list", "--porcelain")).toContain(`branch refs/heads/${second}`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
