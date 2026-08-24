import { execSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { createOutlineBundle } from "../create-outline-bundle";

const capture = `---
date: 2026-08-04
type: capture
status: seed
forgegraph_event_id: "evt-deploy-123"
forgegraph_event_type: "deploy_succeeded"
forgegraph_source_visibility: "internal"
human_review_required: true
---

# ForgeGraph production deployment succeeded

## Source boundary

> Rewrite and verify every detail before publishing.

## Why it caught my attention

The automation should preserve human voice instead of replacing it.

## Facts from ForgeGraph

- App: ForgeGraph
- Event: deploy succeeded
- Summary: Production is serving the reviewed commit.

## Video or demo notes

Show the review desk and the evidence handoff.

## Evidence and media

<!-- forgegraph:evidence:start -->
- [Review desk clip](https://example.com/review.webm) (clip, fresh)
- [Review desk screenshot](https://example.com/review.png) (screenshot, fresh)
<!-- forgegraph:evidence:end -->
`;

function initVault(root: string) {
  execSync("git init", { cwd: root, stdio: "pipe" });
  execSync(
    'git -c user.name="Test" -c user.email="test@test" commit --allow-empty -m "init"',
    { cwd: root, stdio: "pipe" },
  );
}

describe("createOutlineBundle", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs) {
      rmSync(dir, { recursive: true, force: true });
    }
    tempDirs.length = 0;
  });

  it("creates a source-linked outline scaffold without final prose", async () => {
    const root = mkdtempSync(join(tmpdir(), "ooda-outline-"));
    tempDirs.push(root);
    initVault(root);

    const result = await createOutlineBundle({
      storageRoot: root,
      sources: [
        {
          filePath: "/vault/Captures/forgegraph-deploy.md",
          content: capture,
        },
      ],
      context: [
        {
          filePath: "/vault/Projects/ForgeGraph.md",
          content: "# ForgeGraph\n\nProject context written by a human.",
        },
      ],
      now: new Date("2026-08-05T12:00:00.000Z"),
    });

    expect(result.status).toBe("created");
    expect(result.sourceEventIds).toEqual(["evt-deploy-123"]);
    expect(existsSync(result.outlinePath)).toBe(true);
    expect(existsSync(result.provenancePath)).toBe(true);

    const outline = readFileSync(result.outlinePath, "utf8");
    expect(outline).toContain("status: outline");
    expect(outline).toContain("final_prose_generated: false");
    expect(outline).toContain('source_event_ids: ["evt-deploy-123"]');
    expect(outline).toContain("Production is serving the reviewed commit.");
    expect(outline).toContain("Rewrite and verify every detail");
    expect(outline).toContain(
      "What surprised, frustrated, or changed your mind?",
    );
    expect(outline).toContain("## Format cuts");
    expect(outline).toContain("https://example.com/review.webm");
    expect(outline).toContain("/vault/Projects/ForgeGraph.md");
    expect(outline).toContain("## Human notes");
    expect(outline).not.toContain("Here is your finished post");

    const provenance = JSON.parse(
      readFileSync(result.provenancePath, "utf8"),
    ) as Record<string, unknown>;
    expect(provenance.sourceType).toBe("file");
    expect(provenance.operationId).toBe("forgegraph-outline-bundle");
  });

  it("does not overwrite an existing bundle for the same source events", async () => {
    const root = mkdtempSync(join(tmpdir(), "ooda-outline-"));
    tempDirs.push(root);
    initVault(root);

    const input = {
      storageRoot: root,
      sources: [{ filePath: "/vault/capture.md", content: capture }],
      now: new Date("2026-08-05T12:00:00.000Z"),
    };
    const first = await createOutlineBundle(input);
    const original = readFileSync(first.outlinePath, "utf8");

    const second = await createOutlineBundle({
      ...input,
      sources: [
        {
          filePath: "/vault/capture.md",
          content: capture.replace("reviewed commit", "different commit"),
        },
      ],
      now: new Date("2026-08-06T12:00:00.000Z"),
    });

    expect(second.status).toBe("existing");
    expect(readFileSync(second.outlinePath, "utf8")).toBe(original);
  });

  it("rejects notes that are not ForgeGraph captures", async () => {
    const root = mkdtempSync(join(tmpdir(), "ooda-outline-"));
    tempDirs.push(root);
    initVault(root);

    await expect(
      createOutlineBundle({
        storageRoot: root,
        sources: [
          {
            filePath: "/vault/random.md",
            content: "# A note without ForgeGraph provenance",
          },
        ],
      }),
    ).rejects.toThrow("forgegraph_event_id");
  });
});
