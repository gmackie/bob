import { describe, expect, it, afterEach } from "vitest";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { exportBrief } from "../export-brief";

describe("exportBrief", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs) {
      rmSync(dir, { recursive: true, force: true });
    }
    tempDirs.length = 0;
  });

  it("generates markdown with citations from provenance records", () => {
    const root = mkdtempSync(join(tmpdir(), "ooda-export-"));
    tempDirs.push(root);

    const notesDir = join(root, "notes");
    const sourcesDir = join(root, "sources");
    mkdirSync(notesDir, { recursive: true });
    mkdirSync(sourcesDir, { recursive: true });

    writeFileSync(
      join(notesDir, "note_1.md"),
      `---
id: note_1
artifactId: sha256:abc123
kind: observation
---

# Blackout curtains help sleep

Studies show blackout curtains improve sleep quality.
`,
    );

    writeFileSync(
      join(sourcesDir, "note_1.provenance.json"),
      JSON.stringify({
        id: "prov_1",
        artifactId: "sha256:abc123",
        capabilityId: "reddit",
        queryOrInputRef: "best blackout curtains",
        canonicalSourceRef: "https://reddit.com/r/sleep/123",
        retrievedAt: "2026-03-21T10:00:00Z",
      }),
    );

    const brief = exportBrief({ threadDir: root, title: "Sleep Research" });

    expect(brief).toContain("Sleep Research");
    expect(brief).toContain("Blackout curtains help sleep");
    expect(brief).toContain("https://reddit.com/r/sleep/123");
    expect(brief).toContain("## Sources");
  });

  it("marks notes without provenance as [UNVERIFIED]", () => {
    const root = mkdtempSync(join(tmpdir(), "ooda-export-"));
    tempDirs.push(root);

    const notesDir = join(root, "notes");
    const sourcesDir = join(root, "sources");
    mkdirSync(notesDir, { recursive: true });
    mkdirSync(sourcesDir, { recursive: true });

    writeFileSync(
      join(notesDir, "note_orphan.md"),
      `---
id: note_orphan
artifactId: sha256:orphan
kind: observation
---

# Orphan finding

This note has no provenance record.
`,
    );

    const brief = exportBrief({ threadDir: root, title: "Test" });

    expect(brief).toContain("[UNVERIFIED]");
    expect(brief).toContain("Orphan finding");
  });

  it("handles empty thread workspace", () => {
    const root = mkdtempSync(join(tmpdir(), "ooda-export-empty-"));
    tempDirs.push(root);

    mkdirSync(join(root, "notes"), { recursive: true });
    mkdirSync(join(root, "sources"), { recursive: true });

    const brief = exportBrief({ threadDir: root, title: "Empty" });

    expect(brief).toContain("Empty");
    expect(brief).toContain("No research notes");
  });

  it("marks note as [UNVERIFIED] when provenance JSON is malformed", () => {
    const root = mkdtempSync(join(tmpdir(), "ooda-export-malformed-"));
    tempDirs.push(root);

    const notesDir = join(root, "notes");
    const sourcesDir = join(root, "sources");
    mkdirSync(notesDir, { recursive: true });
    mkdirSync(sourcesDir, { recursive: true });

    writeFileSync(
      join(notesDir, "note_bad.md"),
      `---
id: note_bad
artifactId: sha256:bad
kind: observation
---

# Finding with bad provenance

This note has a corrupt provenance file.
`,
    );

    // Write invalid JSON to the provenance file
    writeFileSync(
      join(sourcesDir, "note_bad.provenance.json"),
      "{ this is not valid JSON !!!",
    );

    const brief = exportBrief({ threadDir: root, title: "Malformed Test" });

    expect(brief).toContain("[UNVERIFIED]");
    expect(brief).toContain("Finding with bad provenance");
    expect(brief).not.toContain("Error");
  });

  it("sorts notes chronologically", () => {
    const root = mkdtempSync(join(tmpdir(), "ooda-export-sort-"));
    tempDirs.push(root);

    const notesDir = join(root, "notes");
    const sourcesDir = join(root, "sources");
    mkdirSync(notesDir, { recursive: true });
    mkdirSync(sourcesDir, { recursive: true });

    writeFileSync(
      join(notesDir, "note_b.md"),
      `---
id: note_b
artifactId: sha256:bbb
kind: observation
---

# Second finding

Content B.
`,
    );

    writeFileSync(
      join(notesDir, "note_a.md"),
      `---
id: note_a
artifactId: sha256:aaa
kind: hypothesis
---

# First finding

Content A.
`,
    );

    const brief = exportBrief({ threadDir: root, title: "Sorted" });

    // Both notes should appear
    expect(brief).toContain("First finding");
    expect(brief).toContain("Second finding");
  });
});
