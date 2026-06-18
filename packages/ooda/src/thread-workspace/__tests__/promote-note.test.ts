import { describe, expect, it, afterEach } from "vitest";
import {
  mkdtempSync,
  existsSync,
  readFileSync,
  rmSync,
} from "node:fs";
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

describe("promoteNote", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs) {
      rmSync(dir, { recursive: true, force: true });
    }
    tempDirs.length = 0;
  });

  it("writes note and provenance atomically in a single git commit", async () => {
    const root = mkdtempSync(join(tmpdir(), "ooda-promote-"));
    tempDirs.push(root);
    initVaultRepo(root);

    const { threadDir } = await createThreadWorkspace({
      storageRoot: root,
      slug: "sleep-test",
      title: "Sleep Test",
    });

    const result = await promoteNote({
      storageRoot: root,
      threadDir,
      sessionId: "session_1",
      kind: "observation",
      title: "Blackout curtains help",
      content:
        "Studies show blackout curtains improve sleep quality by reducing light exposure.",
      provenance: {
        capabilityId: "reddit",
        operationId: "search",
        sourceType: "api",
        queryOrInputRef: "blackout curtains sleep",
        canonicalSourceRef: "https://reddit.com/r/sleep/123",
      },
    });

    // Note file exists
    expect(existsSync(result.notePath)).toBe(true);
    const noteContent = readFileSync(result.notePath, "utf-8");
    expect(noteContent).toContain("Blackout curtains help");

    // Provenance file exists
    expect(existsSync(result.provenancePath)).toBe(true);
    const prov = JSON.parse(readFileSync(result.provenancePath, "utf-8"));
    expect(prov.capabilityId).toBe("reddit");
    expect(prov.artifactId).toMatch(/^sha256:/);

    // Both were committed atomically
    const log = execSync("git log --oneline", { cwd: root }).toString();
    expect(log).toContain("Promote:");

    // Artifact ID matches content hash
    expect(result.artifactId).toMatch(/^sha256:/);
    expect(prov.artifactId).toBe(result.artifactId);
  });

  it("generates deterministic artifact IDs for same content", async () => {
    const root = mkdtempSync(join(tmpdir(), "ooda-determ-"));
    tempDirs.push(root);
    initVaultRepo(root);

    const { threadDir } = await createThreadWorkspace({
      storageRoot: root,
      slug: "determ-test",
      title: "Determinism Test",
    });

    const content = "Exact same content for determinism test.";

    const result1 = await promoteNote({
      storageRoot: root,
      threadDir,
      sessionId: "session_1",
      kind: "observation",
      title: "Note 1",
      content,
      provenance: {
        capabilityId: "reddit",
        operationId: "search",
        sourceType: "api",
        queryOrInputRef: "test",
      },
    });

    const result2 = await promoteNote({
      storageRoot: root,
      threadDir,
      sessionId: "session_1",
      kind: "observation",
      title: "Note 2",
      content,
      provenance: {
        capabilityId: "reddit",
        operationId: "search",
        sourceType: "api",
        queryOrInputRef: "test",
      },
    });

    // Same content = same artifact ID
    expect(result1.artifactId).toBe(result2.artifactId);
  });
});
