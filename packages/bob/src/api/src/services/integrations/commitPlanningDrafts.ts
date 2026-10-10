import { and, eq } from "@bob/db";
import type { Db } from "@bob/db/client";
import { chatConversations, planDrafts, projects, workItems } from "@bob/db/schema";

import { resolvePlanningProvider, PlanningProviderError } from "./planningProvider.js";

export interface CommittedPlanningIssue {
  draftId: string;
  taskId: string;
  identifier: string;
}

export interface CommitPlanningDraftsResult {
  committed: number;
  workspaceId: string | null;
  tasks: CommittedPlanningIssue[];
  retry: boolean;
}

const EMPTY: CommitPlanningDraftsResult = {
  committed: 0,
  workspaceId: null,
  tasks: [],
  retry: false,
};

/**
 * Turn open plan drafts into provider issues.
 *
 * A Linear integration whose API URL points at Kanbanger creates those issues
 * there. The local work item is what Bob runs. A draft that already has an
 * issue id is not created again.
 */
export async function commitOpenPlanningDrafts(
  db: Db,
  sessionId: string,
): Promise<CommitPlanningDraftsResult> {
  const session = await db.query.chatConversations.findFirst({
    where: eq(chatConversations.id, sessionId),
    columns: { userId: true, sessionType: true },
  });
  if (session?.sessionType !== "planning" || !session.userId) return EMPTY;

  const drafts = await db.query.planDrafts.findMany({
    where: and(eq(planDrafts.sessionId, sessionId), eq(planDrafts.status, "draft")),
    orderBy: [planDrafts.sortOrder, planDrafts.createdAt],
  });
  if (drafts.length === 0) return EMPTY;

  const tasks: CommittedPlanningIssue[] = [];
  let workspaceId: string | null = null;
  let retry = false;

  for (const draft of drafts) {
    try {
      const project = await db.query.projects.findFirst({
        where: eq(projects.id, draft.projectId),
      });
      if (!project) {
        console.error(`[planning-drafts] Project not found for draft ${draft.id}`);
        continue;
      }
      workspaceId = project.workspaceId;

      let issueId = draft.planningTaskId;
      let identifier = draft.planningTaskIdentifier;
      if (!issueId || !identifier) {
        const provider = await resolvePlanningProvider(
          db,
          project,
          project.workspaceId,
          session.userId,
        );
        const created = await provider.createTask({
          title: draft.title,
          description: draft.description ?? null,
          providerProjectId: project.linearProjectId ?? project.id,
          priority: draft.priority,
        });
        issueId = created.externalId;
        identifier = created.identifier;
        await db
          .update(planDrafts)
          .set({
            planningTaskId: issueId,
            planningTaskIdentifier: identifier,
          })
          .where(eq(planDrafts.id, draft.id));
      }

      const workItemId = await ensureWorkItem(db, {
        userId: session.userId,
        project,
        issueId,
        title: draft.title,
        description: draft.description,
      });

      await db
        .update(planDrafts)
        .set({ workItemId, status: "committed" })
        .where(eq(planDrafts.id, draft.id));

      tasks.push({ draftId: draft.id, taskId: workItemId, identifier });
    } catch (err) {
      const permanent = err instanceof PlanningProviderError && !err.retriable;
      if (!permanent) retry = true;
      console.error(`[planning-drafts] Failed to create issue for draft ${draft.id}:`, err);
    }
  }

  return { committed: tasks.length, workspaceId, tasks, retry };
}

async function ensureWorkItem(
  db: Db,
  input: {
    userId: string;
    project: { id: string; workspaceId: string; planningProvider: string };
    issueId: string;
    title: string;
    description: string | null;
  },
): Promise<string> {
  if (input.project.planningProvider === "internal") return input.issueId;

  const existing = await db.query.workItems.findFirst({
    where: and(
      eq(workItems.externalProvider, input.project.planningProvider),
      eq(workItems.externalId, input.issueId),
      eq(workItems.workspaceId, input.project.workspaceId),
    ),
    columns: { id: true },
  });
  if (existing) return existing.id;

  const [created] = await db
    .insert(workItems)
    .values({
      ownerUserId: input.userId,
      workspaceId: input.project.workspaceId,
      projectId: input.project.id,
      kind: "task",
      title: input.title,
      description: input.description,
      status: "backlog",
      externalId: input.issueId,
      externalProvider: input.project.planningProvider,
    })
    .onConflictDoNothing()
    .returning({ id: workItems.id });

  if (created) return created.id;

  const raced = await db.query.workItems.findFirst({
    where: and(
      eq(workItems.externalProvider, input.project.planningProvider),
      eq(workItems.externalId, input.issueId),
    ),
    columns: { id: true },
  });
  if (!raced) {
    throw new PlanningProviderError(
      "Created issue could not be linked to a work item",
      "CREATE_FAILED",
      true,
    );
  }
  return raced.id;
}
