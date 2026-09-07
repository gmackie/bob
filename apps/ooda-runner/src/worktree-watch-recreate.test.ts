import { expect, it } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { watchWorktree } from "./worktree-watch";
it("observes edits inside a deleted and recreated source directory", async () => {
  const root = mkdtempSync(join(tmpdir(), "watch-recreate-"));
  const nested = join(root, "src", "nested");
  mkdirSync(nested, { recursive: true });
  const touched: string[] = [];
  const watcher = watchWorktree({
    path: root,
    branch: "main",
    baseBranch: "main",
    intervalMs: 20,
    emit: (event) => touched.push(...event.touched),
  });
  try {
    rmSync(nested, { recursive: true });
    await new Promise((resolve) => setTimeout(resolve, 100));
    mkdirSync(nested);
    await new Promise((resolve) => setTimeout(resolve, 100));
    writeFileSync(join(nested, "restored.ts"), "updated");
    await expect
      .poll(() => touched, { timeout: 1500 })
      .toContain("src/nested/restored.ts");
  } finally {
    watcher.stop();
    rmSync(root, { recursive: true, force: true });
  }
});
