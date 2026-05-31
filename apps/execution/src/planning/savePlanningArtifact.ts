import { createHash } from "node:crypto";

import { and, eq } from "@bob/db";
import { db } from "@bob/db/client";
import { assertWorkspaceQuota } from "@bob/db/quotas";
import { workItemArtifacts, workItems } from "@bob/db/schema";

export interface SavePlanningArtifactInput {
  /** The planning chat session that produced this artifact. */
  sessionId: string;
  /** The work item to attach the artifact to. */
  workItemId: string;
  /** Artifact type — typically "planning_doc" for planning sessions. */
  artifactType: "planning_doc";
  /** Human-readable title for the artifact. */
  title: string;
  /** The full markdown content of the planning document. */
  content: string;
  /** Optional one-line summary. */
  summary?: string;
}

/**
 * Save an inline planning artifact (e.g. a planning doc produced by a
 * planning session) directly to the work item's artifacts table.
 *
 * This uses direct DB access (same pattern as the rest of the execution
 * layer) rather than going through tRPC, so it can be called from the
 * gateway/execution context without authentication ceremony.
 *
 * Idempotent: deduplicates on (sessionId, workItemId, artifactType) via
 * the producerId field.
 */
export async function savePlanningArtifact(
  input: SavePlanningArtifactInput,
): Promise<{ id: string; created: boolean }> {
  const producerId = createHash("sha256")
    .update(
      [
        "planning_artifact",
        input.sessionId,
        input.workItemId,
        input.artifactType,
      ].join("|"),
    )
    .digest("hex");

  // Check for existing artifact with same producer fingerprint
  const existing = await db.query.workItemArtifacts.findFirst({
    where: and(
      eq(workItemArtifacts.workItemId, input.workItemId),
      eq(workItemArtifacts.producerType, "bob"),
      eq(workItemArtifacts.producerId, producerId),
    ),
  });

  if (existing) {
    // Update the content in place (planning docs evolve during the session)
    await db
      .update(workItemArtifacts)
      .set({
        title: input.title,
        content: input.content,
        summary: input.summary ?? existing.summary,
      })
      .where(eq(workItemArtifacts.id, existing.id));

    return { id: existing.id, created: false };
  }

  const workItem = db.query.workItems?.findFirst
    ? await db.query.workItems.findFirst({
        where: eq(workItems.id, input.workItemId),
        columns: { workspaceId: true },
      })
    : null;

  await assertWorkspaceQuota(db, workItem?.workspaceId, "artifacts");

  // Mark any prior planning_doc artifacts for this work item as non-current
  await db
    .update(workItemArtifacts)
    .set({ isCurrent: false })
    .where(
      and(
        eq(workItemArtifacts.workItemId, input.workItemId),
        eq(workItemArtifacts.artifactRole, "documentation"),
        eq(workItemArtifacts.artifactType, "planning_doc"),
        eq(workItemArtifacts.isCurrent, true),
      ),
    );

  const [artifact] = await db
    .insert(workItemArtifacts)
    .values({
      workItemId: input.workItemId,
      sessionId: input.sessionId,
      producerType: "bob",
      producerId,
      artifactType: input.artifactType,
      artifactRole: "documentation",
      title: input.title,
      content: input.content,
      summary: input.summary ?? null,
      url: null,
      metadata: {
        source: "planning_session",
        sessionId: input.sessionId,
      },
      isCurrent: true,
    })
    .returning();

  if (!artifact) {
    throw new Error("Failed to insert planning artifact");
  }

  return { id: artifact.id, created: true };
}
