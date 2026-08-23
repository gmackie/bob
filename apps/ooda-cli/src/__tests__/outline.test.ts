import { execSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { runOutline } from "../commands/outline";

// createOutlineBundle rejects captures without ForgeGraph provenance, so the
// fixture has to be a real capture, not a bare markdown file.
const CAPTURE = `---
date: 2026-08-04
type: capture
status: seed
forgegraph_event_id: "evt-deploy-123"
forgegraph_event_type: "deploy_succeeded"
forgegraph_source_visibility: "internal"
human_review_required: true
---

# ForgeGraph production deployment succeeded

## Why it caught my attention

The automation should preserve human voice instead of replacing it.

## Facts from ForgeGraph

- App: ForgeGraph
- Event: deploy succeeded
`;

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
  tempDirs.length = 0;
});

function makeStorageRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "ooda-cli-outline-"));
  tempDirs.push(root);
  execSync("git init", { cwd: root, stdio: "pipe" });
  execSync(
    'git -c user.name="Test" -c user.email="test@test" commit --allow-empty -m "init"',
    { cwd: root, stdio: "pipe" },
  );
  return root;
}

describe("ooda outline", () => {
  it("reads capture files off disk and writes a bundle into the vault", async () => {
    const storageRoot = makeStorageRoot();
    const capture = join(storageRoot, "capture.md");
    writeFileSync(capture, CAPTURE);

    const result = await runOutline({
      storageRoot,
      sourceFiles: [capture],
      threadSlug: "outline-smoke",
    });

    expect(result.status).toBe("created");
    expect(existsSync(result.outlinePath)).toBe(true);
  });

  // The command is the only reason create-outline-bundle came across in the
  // fold; content-hash idempotency is the behaviour that makes re-running it
  // on the same captures safe.
  it("keeps the existing bundle when re-run on identical captures", async () => {
    const storageRoot = makeStorageRoot();
    const capture = join(storageRoot, "capture.md");
    writeFileSync(capture, CAPTURE);

    const input = {
      storageRoot,
      sourceFiles: [capture],
      threadSlug: "outline-idempotent",
    };
    const first = await runOutline(input);
    const second = await runOutline(input);

    expect(first.status).toBe("created");
    expect(second.status).toBe("existing");
    expect(second.outlinePath).toBe(first.outlinePath);
  });
});
