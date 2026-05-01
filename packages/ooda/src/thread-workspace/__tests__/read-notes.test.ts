import { describe, expect, it, afterEach } from "vitest";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { readNotes } from "../read-notes";

describe("readNotes", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs) {
      rmSync(dir, { recursive: true, force: true });
    }
    tempDirs.length = 0;
  });

  it("reads notes with provenance from a workspace", () => {
    const root = mkdtempSync(join(tmpdir(), "ooda-read-"));
    tempDirs.push(root);
    const notesDir = join(root, "notes");
    const sourcesDir = join(root, "sources");
    mkdirSync(notesDir, { recursive: true });
    mkdirSync(sourcesDir, { recursive: true });

    writeFileSync(
      join(notesDir, "note-abc123.md"),
      `---
kind: observation
title: Blackout curtains help sleep
artifactId: sha256:abc123
sessionId: sess_1
promotedAt: 2026-03-22T10:00:00Z
---

Blackout curtains reduce light exposure by 95%.`,
    );

    writeFileSync(
      join(sourcesDir, "note-abc123.provenance.json"),
      JSON.stringify({
        artifactId: "sha256:abc123",
        capabilityId: "reddit",
        queryOrInputRef: "best blackout curtains",
      }),
    );

    const notes = readNotes(root);
    expect(notes).toHaveLength(1);
    expect(notes[0]!.kind).toBe("observation");
    expect(notes[0]!.title).toBe("Blackout curtains help sleep");
    expect(notes[0]!.content).toContain("Blackout curtains reduce");
    expect(notes[0]!.provenanceRef).toBeDefined();
  });

  it("returns empty array for workspace with no notes", () => {
    const root = mkdtempSync(join(tmpdir(), "ooda-empty-"));
    tempDirs.push(root);
    mkdirSync(join(root, "notes"), { recursive: true });

    const notes = readNotes(root);
    expect(notes).toHaveLength(0);
  });

  it("returns empty array when notes directory does not exist", () => {
    const root = mkdtempSync(join(tmpdir(), "ooda-nodir-"));
    tempDirs.push(root);

    const notes = readNotes(root);
    expect(notes).toHaveLength(0);
  });

  it("handles missing provenance gracefully", () => {
    const root = mkdtempSync(join(tmpdir(), "ooda-noprov-"));
    tempDirs.push(root);
    mkdirSync(join(root, "notes"), { recursive: true });

    writeFileSync(
      join(root, "notes", "note-xyz.md"),
      `---
kind: hypothesis
title: Light matters more than melatonin
artifactId: sha256:xyz
sessionId: sess_2
promotedAt: 2026-03-22T11:00:00Z
---

Environmental controls may be more effective.`,
    );

    const notes = readNotes(root);
    expect(notes).toHaveLength(1);
    expect(notes[0]!.provenanceRef).toBeUndefined();
  });
});
