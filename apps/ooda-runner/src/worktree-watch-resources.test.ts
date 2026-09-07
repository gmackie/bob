import { afterEach, expect, it, vi } from "vitest";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { EventEmitter } from "node:events";
import { tmpdir } from "node:os";
import { join } from "node:path";
const calls = vi.hoisted(() => ({
  paths: [] as string[],
  recursive: [] as unknown[],
}));
vi.mock("node:fs", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  watch: (path: string, options: unknown) => {
    calls.paths.push(path);
    calls.recursive.push(typeof options === "object" ? options : {});
    return Object.assign(new EventEmitter(), { close: vi.fn() });
  },
}));
import { watchWorktree } from "./worktree-watch";
let root: string;
afterEach(() => {
  if (root) rmSync(root, { recursive: true, force: true });
  calls.paths.length = 0;
  calls.recursive.length = 0;
});
it("does not register kernel watches inside ignored dependency and git directories", () => {
  root = mkdtempSync(join(tmpdir(), "watch-resource-"));
  for (const name of [
    "src/lib",
    "node_modules/package/deep",
    ".git/objects",
    "src/node_modules/nested",
  ])
    mkdirSync(join(root, name), { recursive: true });
  const watcher = watchWorktree({
    path: root,
    branch: "test",
    baseBranch: "main",
    emit: () => {},
  });
  try {
    expect(calls.recursive).not.toContainEqual({ recursive: true });
    expect(calls.paths.sort()).toEqual(
      [root, join(root, "src"), join(root, "src/lib")].sort(),
    );
  } finally {
    watcher.stop();
  }
});
