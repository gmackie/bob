// The planning review behind ui://bob/workspace.html and planning-review.html:
// work items and runs in the grant's workspace, and the approval a person
// records in the view before bob_planning_dispatch will run a work item.
import { Effect } from "effect";
import type { Db } from "@bob/db/client";
import { and, eq, isNull } from "@bob/db";
import { mcpDispatchApprovals, workItems } from "@bob/db/schema";
import { wrapHandler } from "@bob/api/handlers/bridge";
import { workspaceRunSummaries } from "@bob/api/handlers/publicApi";
import {
  BIZPULSE_CREDENTIAL_SETUP,
  workItemsDispatch,
  workItemsList,
} from "@bob/api/handlers/workItems";
import {
  buildPlanningWorkflow,
  normalizeBobRun,
  normalizeBobWorkItem,
  planningDispatchBlocker,
} from "./views/planning";
import type { PlanningData, WorkspaceData } from "./views/render";
import type { RunSummary } from "./views/types";
import type { OAuthGrant } from "./types";
import { WRITE_SCOPE } from "./oauth";
import { McpToolError } from "./errors";

export function workspacePollSeconds(raw = process.env.BOB_POLL_SECONDS) {
  const value = Number(raw);
  if (!raw?.trim() || !Number.isFinite(value)) return 60;
  return Math.max(15, Math.min(3600, Math.round(value)));
}

type WorkItemRow = typeof workItems.$inferSelect;
interface RunRow {
  id: string;
  workItemId: string | null;
  threadId: string | null;
  agentType: string | null;
  status: string;
  summary: Record<string, unknown> | null;
  createdAt: string | Date | null;
}

// Drizzle returns timestamps as strings in "string" mode and Dates otherwise.
const iso = (date: string | Date | null | undefined) =>
  date instanceof Date ? date.toISOString() : (date ?? null);
// A run's summary is free-form JSON; show its text when it has one.
const summaryText = (summary: Record<string, unknown> | null) => {
  const text = summary?.text ?? summary?.message ?? summary?.summary;
  return typeof text === "string" ? text : null;
};
const workItem = (row: WorkItemRow) =>
  normalizeBobWorkItem({
    id: row.id,
    title: row.title,
    description: row.description,
    status: row.status,
    projectId: row.projectId,
    updatedAt: iso(row.updatedAt),
  });
const runs = (rows: readonly RunRow[]): RunSummary[] =>
  rows.map((run) =>
    normalizeBobRun({
      ...run,
      summary: summaryText(run.summary),
      createdAt: iso(run.createdAt),
    }),
  );

export function makePlanning(db: Db) {
  const ctx = (grant: OAuthGrant) => ({ db, userId: grant.userId });

  async function requireItem(grant: OAuthGrant, id: string) {
    const item = await db.query.workItems.findFirst({
      where: and(
        eq(workItems.id, id),
        eq(workItems.workspaceId, grant.workspaceId),
      ),
    });
    if (!item) throw new McpToolError("Work item not found");
    return item;
  }

  const listRuns = async (grant: OAuthGrant, filters: { workItemId?: string; projectId?: string; threadId?: string } = {}) =>
    runs(await Effect.runPromise(wrapHandler(workspaceRunSummaries, ctx(grant), {
      ...filters, workspaceId: grant.workspaceId, limit: filters.workItemId ? 20 : 50,
    })));

  async function approval(workspaceId: string, workItemId: string) {
    const row = await db.query.mcpDispatchApprovals.findFirst({
      where: and(eq(mcpDispatchApprovals.workspaceId, workspaceId), eq(mcpDispatchApprovals.workItemId, workItemId)),
    });
    return {
      approved: row !== undefined,
      dispatchRequested: Boolean(row?.dispatchedAt),
    };
  }

  async function review(grant: OAuthGrant, workItemId: string, mayWrite = grant.scopes.includes(WRITE_SCOPE)) {
    const row = await requireItem(grant, workItemId);
    const [itemRunList, state] = await Promise.all([
      listRuns(grant, { workItemId }),
      approval(grant.workspaceId, workItemId),
    ]);
    const item = workItem(row);
    const data: PlanningData = {
      workItem: item,
      runs: itemRunList,
      workflow: buildPlanningWorkflow(item, itemRunList, state),
    };
    const blocker = row.externalProvider === BIZPULSE_CREDENTIAL_SETUP
      ? "Open the work item in Bob for owner approval and dispatch."
      : planningDispatchBlocker(item, itemRunList, state);
    if (row.externalProvider === BIZPULSE_CREDENTIAL_SETUP || !mayWrite)
      data.workflow = { ...data.workflow, actions: [] };
    return { data, state, blocker };
  }

  return {
    async workspace(
      grant: OAuthGrant,
      input: { projectId?: string; query?: string; threadId?: string },
    ): Promise<WorkspaceData> {
      const [rows, runList] = await Promise.all([
        Effect.runPromise(
          wrapHandler(workItemsList, ctx(grant), {
            workspaceId: grant.workspaceId,
            projectId: input.projectId, query: input.query,
            limit: 100,
          }),
        ),
        listRuns(grant, { projectId: input.projectId, threadId: input.threadId }).then(
          (runs) => ({ runs }),
          () => ({ runs: [], runsError: "Bob runs are unavailable" }),
        ),
      ]);
      return {
        workspaceId: grant.workspaceId,
        ...(input.threadId ? { threadId: input.threadId } : {}),
        workItems: rows.map(workItem),
        ...runList,
        pollSeconds: workspacePollSeconds(),
        refreshedAt: new Date().toISOString(),
      };
    },

    review: async (grant: OAuthGrant, workItemId: string, mayWrite: boolean) =>
      (await review(grant, workItemId, mayWrite)).data,

    item: async (grant: OAuthGrant, id: string) => ({ item: workItem(await requireItem(grant, id)) }),

    runs: async (grant: OAuthGrant, filters: { workItemId?: string; threadId?: string }) => {
      if (filters.workItemId) await requireItem(grant, filters.workItemId);
      return listRuns(grant, filters);
    },

    async approve(grant: OAuthGrant, workItemId: string) {
      const { blocker } = await review(grant, workItemId);
      if (blocker) throw new McpToolError(blocker);
      await db
        .insert(mcpDispatchApprovals)
        .values({
          workItemId,
          workspaceId: grant.workspaceId,
          approvedBy: grant.userId,
        })
        .onConflictDoUpdate({
          target: mcpDispatchApprovals.workItemId,
          setWhere: isNull(mcpDispatchApprovals.dispatchedAt),
          set: { workspaceId: grant.workspaceId, approvedBy: grant.userId, approvedAt: new Date() },
        });
    },

    async dispatch(
      grant: OAuthGrant,
      input: { workItemId: string; agentType?: string },
    ) {
      // Same switch as REST dispatch (publicApi.dispatchExistingWorkItem).
      if (process.env.BOB_OODA_DISPATCH_ENABLED !== "true")
        throw new McpToolError("API execution dispatch is disabled");
      const { state, blocker } = await review(grant, input.workItemId);
      if (blocker) throw new McpToolError(blocker);
      if (!state.approved)
        throw new McpToolError(
          "Bob dispatch must be approved in the planning review before execution",
        );
      // Spending the approval first makes concurrent dispatches race for one row.
      const claimed = await db
        .update(mcpDispatchApprovals)
        .set({ dispatchedAt: new Date() })
        .where(
          and(
            eq(mcpDispatchApprovals.workspaceId, grant.workspaceId),
            eq(mcpDispatchApprovals.workItemId, input.workItemId),
            isNull(mcpDispatchApprovals.dispatchedAt),
          ),
        )
        .returning({ workItemId: mcpDispatchApprovals.workItemId });
      if (claimed.length === 0)
        throw new McpToolError("Bob dispatch was already requested; refresh the existing run evidence");
      let session;
      try {
        session = await Effect.runPromise(
          wrapHandler(workItemsDispatch, ctx(grant), input),
        );
      } catch (error) {
        await db
          .update(mcpDispatchApprovals)
          .set({ dispatchedAt: null })
          .where(and(eq(mcpDispatchApprovals.workspaceId, grant.workspaceId), eq(mcpDispatchApprovals.workItemId, input.workItemId)));
        throw error;
      }
      // A failed refresh after successful dispatch must never re-arm the approval.
      return {
        ...(await review(grant, input.workItemId)).data,
        dispatched: {
          ...session, sessionStatus: session.status,
          ...normalizeBobRun({ id: session.sessionId, workItemId: input.workItemId, status: session.status }),
        },
      };
    },
  };
}
