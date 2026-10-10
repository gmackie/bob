import { eq, inArray } from "@bob/db";
import { db } from "@bob/db/client";
import { chatConversations, planDraftDependencies, planDrafts } from "@bob/db/schema";

import {
  missingDraftDependencies,
  normalizePlanningTasks,
  planDraftSync,
  planningDraftTitleKey,
} from "./planning-drafts.js";
import type { ExistingPlanDraft } from "./planning-drafts.js";

export interface PlanningDraftSyncResult {
  changed: boolean;
  created: number;
  updated: number;
  workspaceId: string | null;
  projectId: string | null;
  draftIds: string[];
}

const EMPTY: PlanningDraftSyncResult = {
  changed: false,
  created: 0,
  updated: 0,
  workspaceId: null,
  projectId: null,
  draftIds: [],
};

export async function syncSessionPlanningDrafts(
  sessionId: string,
  payload: unknown,
): Promise<PlanningDraftSyncResult> {
  const tasks = normalizePlanningTasks(payload);
  if (tasks.length === 0) return EMPTY;

  return db.transaction(async (tx) => {
    const session = await tx.query.chatConversations.findFirst({
      where: eq(chatConversations.id, sessionId),
      columns: {
        sessionType: true,
        planningWorkspaceId: true,
        planningProjectId: true,
      },
    });
    if (!session || session.sessionType !== "planning") return EMPTY;

    const workspaceId = session.planningWorkspaceId;
    const projectId = session.planningProjectId;
    if (!workspaceId || !projectId) {
      console.warn(
        `[planning-drafts] Session ${sessionId} has no planning project; drafts were not saved`,
      );
      return EMPTY;
    }

    const existing = (await tx.query.planDrafts.findMany({
      where: eq(planDrafts.sessionId, sessionId),
      columns: {
        id: true,
        title: true,
        description: true,
        kind: true,
        priority: true,
        sortOrder: true,
        status: true,
      },
    })) as ExistingPlanDraft[];

    const plan = planDraftSync(existing, tasks);
    const inserted: Array<{ key: string; id: string }> = [];
    for (const task of plan.inserts) {
      const [row] = await tx
        .insert(planDrafts)
        .values({
          sessionId,
          workspaceId,
          projectId,
          title: task.title,
          description: task.description,
          kind: task.kind,
          priority: task.priority,
          sortOrder: task.sortOrder,
        })
        .returning({ id: planDrafts.id });
      if (row) inserted.push({ key: task.key, id: row.id });
    }

    for (const update of plan.updates) {
      await tx
        .update(planDrafts)
        .set({
          description: update.description,
          kind: update.kind,
          priority: update.priority,
          sortOrder: update.sortOrder,
        })
        .where(eq(planDrafts.id, update.id));
    }

    const fromIds = new Set<string>(inserted.map((row) => row.id));
    for (const dependency of plan.dependencies) {
      const match = existing.find(
        (row) =>
          row.status === "draft" && planningDraftTitleKey(row.title) === dependency.fromKey,
      );
      if (match) fromIds.add(match.id);
    }

    const already = fromIds.size
      ? await tx
          .select({
            draftId: planDraftDependencies.draftId,
            dependsOnDraftId: planDraftDependencies.dependsOnDraftId,
          })
          .from(planDraftDependencies)
          .where(inArray(planDraftDependencies.draftId, [...fromIds]))
      : [];

    const missing = missingDraftDependencies(existing, inserted, plan.dependencies, already);
    for (const dependency of missing) {
      await tx.insert(planDraftDependencies).values(dependency).onConflictDoNothing();
    }

    const draftIds = [
      ...new Set([
        ...inserted.map((row) => row.id),
        ...plan.updates.map((update) => update.id),
        ...missing.map((dependency) => dependency.draftId),
      ]),
    ];
    if (draftIds.length === 0) return { ...EMPTY, workspaceId, projectId };

    console.log(
      `[planning-drafts] Session ${sessionId}: ${inserted.length} created, ${plan.updates.length} updated`,
    );
    return {
      changed: true,
      created: inserted.length,
      updated: plan.updates.length,
      workspaceId,
      projectId,
      draftIds,
    };
  });
}
