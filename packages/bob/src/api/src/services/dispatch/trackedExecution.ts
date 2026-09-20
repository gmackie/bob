import { TRPCError } from "@trpc/server";
import { captureTraceCarrier } from "@gmacko/core/telemetry/deep";
import type { Db } from "@bob/db/client";
import { getForgeGraphClient } from "../forgegraph/config";
import { chatConversations, taskRuns } from "@bob/db/schema";

/** Persist report ownership and dispatch context atomically before delivery. */
export async function createTrackedExecution(
  db: Db,
  sessionInput: typeof chatConversations.$inferInsert,
  owner: { workspaceId: string; workItemId: string; identifier: string; planningProvider: string; issueId?: string; branch?: string },
) {
  let forgeGraphWorkItemId: string | undefined;
  try {
    const fg = getForgeGraphClient();
    const item = await fg?.getWorkItemByExternalId(owner.workItemId, { timeoutMs: 2_000, retry: false });
    // The receiver rejects ambiguous external IDs, including privileged callers.
    if (item?.externalId === owner.workItemId) forgeGraphWorkItemId = item.id;
  } catch {
    // Execution and Bob/Kan reports remain available if mapping is unavailable.
    console.warn("[dispatch] ForgeGraph report mapping unavailable");
  }
  return db.transaction(async (tx) => {
    const persona = sessionInput.personaMetadata ?? {};
    const [session] = await tx.insert(chatConversations).values({
      ...sessionInput,
      workItemId: owner.workItemId,
      personaMetadata: {
        ...persona,
        // Reserved server-owned field, separate from editable persona.metadata.
        traceReportScope: {
          workItemId: owner.workItemId,
          workspaceId: owner.workspaceId,
          ...(owner.issueId ? { issueId: owner.issueId } : {}),
          ...(forgeGraphWorkItemId ? { forgeGraphWorkItemId } : {}),
        },
        metadata: {
          ...(typeof persona.metadata === "object" && persona.metadata !== null ? persona.metadata : {}),
          traceCarrier: captureTraceCarrier(),
        },
      },
    }).returning();
    if (!session) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Failed to create execution session" });
    const [taskRun] = await tx.insert(taskRuns).values({
      userId: sessionInput.userId,
      workItemId: owner.workItemId,
      workItemIdentifierSnapshot: owner.identifier,
      planningWorkspaceId: owner.workspaceId,
      planningItemId: owner.workItemId,
      planningItemIdentifier: owner.identifier,
      planningProvider: owner.planningProvider,
      sessionId: session.id,
      repositoryId: sessionInput.repositoryId,
      status: "starting",
      branch: owner.branch ?? null,
    }).returning();
    if (!taskRun) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Failed to create task run" });
    return session;
  });
}
