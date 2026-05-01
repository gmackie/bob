import { describe, expect, it, afterEach } from "vitest";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execSync } from "node:child_process";

import { createThreadWorkspace } from "../create-thread-workspace";
import { promoteNote } from "../promote-note";

function initVaultRepo(root: string) {
  execSync("git init", { cwd: root, stdio: "pipe" });
  execSync('git -c user.name="Test" -c user.email="test@test" commit --allow-empty -m "init"', {
    cwd: root,
    stdio: "pipe",
  });
}

describe("Concurrent Promotion", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs) {
      rmSync(dir, { recursive: true, force: true });
    }
    tempDirs.length = 0;
  });

  it("handles sequential promotions without corruption", async () => {
    const root = mkdtempSync(join(tmpdir(), "ooda-concurrent-"));
    tempDirs.push(root);
    initVaultRepo(root);

    const { threadDir } = await createThreadWorkspace({
      storageRoot: root,
      slug: "concurrent-test",
      title: "Concurrent Test",
    });

    // Promote multiple notes sequentially
    for (let i = 0; i < 5; i++) {
      await promoteNote({
        storageRoot: root,
        threadDir,
        sessionId: "session_1",
        kind: "observation",
        title: `Finding ${i}`,
        content: `Research content ${i} with unique data.`,
        provenance: {
          capabilityId: "reddit",
          operationId: "search",
          sourceType: "api",
          queryOrInputRef: `query ${i}`,
        },
      });
    }

    const notes = readdirSync(join(threadDir, "notes"));
    const provs = readdirSync(join(threadDir, "sources"));

    expect(notes).toHaveLength(5);
    expect(provs).toHaveLength(5);
  });

  it("each promotion creates exactly one git commit", async () => {
    const root = mkdtempSync(join(tmpdir(), "ooda-commits-"));
    tempDirs.push(root);
    initVaultRepo(root);

    const { threadDir } = await createThreadWorkspace({
      storageRoot: root,
      slug: "commit-test",
      title: "Commit Test",
    });

    const { execSync } = await import("node:child_process");
    const initialCount = execSync("git rev-list --count HEAD", {
      cwd: root,
    })
      .toString()
      .trim();

    await promoteNote({
      storageRoot: root,
      threadDir,
      sessionId: "session_1",
      kind: "observation",
      title: "Single note",
      content: "Single content.",
      provenance: {
        capabilityId: "reddit",
        operationId: "search",
        sourceType: "api",
        queryOrInputRef: "test",
      },
    });

    const afterCount = execSync("git rev-list --count HEAD", {
      cwd: root,
    })
      .toString()
      .trim();

    expect(Number(afterCount)).toBe(Number(initialCount) + 1);
  });
});
