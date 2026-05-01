import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";
import { randomUUID } from "node:crypto";

import { generateArtifactId, createProvenanceRecord } from "@gmacko/ooda/provenance";

import type { NoteKind } from "@gmacko/ooda/thread-model";

export interface PromoteNoteInput {
  storageRoot: string;
  threadDir: string;
  sessionId: string;
  kind: NoteKind;
  title: string;
  content: string;
  /** Thread UUID for entity extraction. If omitted, extraction is deferred to synergy tick. */
  threadId?: string;
  provenance: {
    capabilityId: string;
    operationId: string;
    sourceType: "api" | "web" | "file" | "agent" | "user";
    queryOrInputRef: string;
    canonicalSourceRef?: string;
  };
}

export interface PromoteNoteResult {
  noteId: string;
  artifactId: string;
  notePath: string;
  provenancePath: string;
}

export async function promoteNote(
  input: PromoteNoteInput,
): Promise<PromoteNoteResult> {
  const artifactId = generateArtifactId(input.content);
  const noteId = `note_${randomUUID().slice(0, 8)}`;

  // Write note markdown
  const noteFilename = `${noteId}.md`;
  const notePath = join(input.threadDir, "notes", noteFilename);
  const noteContent = `---
id: ${noteId}
artifactId: ${artifactId}
kind: ${input.kind}
sessionId: ${input.sessionId}
promotedAt: ${new Date().toISOString()}
---

# ${input.title}

${input.content}
`;
  writeFileSync(notePath, noteContent);

  // Write provenance record
  const threadId = input.threadDir.split("/").pop() ?? "unknown";
  const provRecord = createProvenanceRecord({
    artifactId,
    threadId,
    sessionId: input.sessionId,
    capabilityId: input.provenance.capabilityId,
    operationId: input.provenance.operationId,
    sourceType: input.provenance.sourceType,
    queryOrInputRef: input.provenance.queryOrInputRef,
    canonicalSourceRef: input.provenance.canonicalSourceRef,
  });

  const provenanceFilename = `${noteId}.provenance.json`;
  const provenancePath = join(input.threadDir, "sources", provenanceFilename);
  writeFileSync(provenancePath, JSON.stringify(provRecord, null, 2));

  // Atomic git commit: both note and provenance together
  execSync("git add -A", { cwd: input.storageRoot, stdio: "pipe" });
  execSync(
    `git -c user.name="OODA" -c user.email="ooda@local" commit -m "Promote: ${input.title}"`,
    { cwd: input.storageRoot, stdio: "pipe" },
  );

  try {
    execSync("git push origin", { cwd: input.storageRoot, stdio: "pipe" });
  } catch {
    // offline — will sync on next push
  }

  // Fire-and-forget extraction via research-backend sidecar
  const researchApiUrl = process.env.RESEARCH_API_URL;
  if (researchApiUrl && input.threadId) {
    fetch(`${researchApiUrl.replace(/\/+$/, "")}/api/extraction/note`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        thread_id: input.threadId,
        note_id: noteId,
        title: input.title,
        content: input.content,
        kind: input.kind,
        content_hash: artifactId,
      }),
    }).catch(() => {
      // sidecar unreachable — synergy tick backfills
    });
  }

  return {
    noteId,
    artifactId,
    notePath,
    provenancePath,
  };
}
