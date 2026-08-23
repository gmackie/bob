/**
 * Linear setup handler functions — list and connect Linear projects to Bob
 * projects.
 *
 * Phase 7B-4D-beta Task 7.
 */
import { TRPCError } from "@trpc/server";
import { eq, and, inArray } from "@bob/db";
import type { Db } from "@bob/db/client";
import {
  projects,
  workItems,
  workspaceIntegrations,
  workspaceMembers,
} from "@bob/db/schema";
import { LinearClient } from "@linear/sdk";

import {
  ensureLinearProject,
  isOpenLinearState,
  mapLinearStatusToBob,
} from "../services/linear/ensureLinearProject.js";
import { agentOverrideFromLabels } from "../services/linear/agentLabel.js";
import { queueOrderForPriority } from "../services/linear/priority.js";
import { reconcileImportedStatus } from "../services/linear/reconcileStatus.js";

import type { HandlerContext } from "./context.js";

/** Max Linear projects / issues-per-project pulled in a single sync pass. */
const PROJECT_PAGE = 100;
const ISSUE_PAGE = 100;

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

async function getLinearClient(db: Db, workspaceId: string): Promise<LinearClient> {
  const integration = await db
    .select()
    .from(workspaceIntegrations)
    .where(
      and(
        eq(workspaceIntegrations.workspaceId, workspaceId),
        eq(workspaceIntegrations.provider, "linear"),
        eq(workspaceIntegrations.enabled, true),
      ),
    )
    .then((rows) => rows[0]);

  if (!integration?.apiKey) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "Linear integration not configured. Set up an API key first.",
    });
  }

  // A NULL linearApiUrl keeps the SDK's default (api.linear.app). Setting it
  // points the same SDK at a Linear-API-compatible instance — e.g. Kanbanger —
  // which speaks the identical wire protocol and accepts lin_api_/lc_ keys.
  return new LinearClient({
    apiKey: integration.apiKey,
    ...(integration.linearApiUrl ? { apiUrl: integration.linearApiUrl } : {}),
  });
}

async function assertWorkspaceAccess(db: Db, userId: string, workspaceId: string) {
  const membership = await db.query.workspaceMembers.findFirst({
    where: and(
      eq(workspaceMembers.workspaceId, workspaceId),
      eq(workspaceMembers.userId, userId),
    ),
    columns: { id: true },
  });

  if (!membership) {
    throw new TRPCError({ code: "NOT_FOUND" });
  }
}

// ---------------------------------------------------------------------------
// Handler functions
// ---------------------------------------------------------------------------

export async function listLinearProjects(
  ctx: HandlerContext,
  input: { workspaceId: string },
) {
  await assertWorkspaceAccess(ctx.db, ctx.userId, input.workspaceId);
  const client = await getLinearClient(ctx.db, input.workspaceId);

  const result = await client.projects({ first: 100 });
  return result.nodes.map((project) => ({
    id: project.id,
    name: project.name,
    key: project.slugId || project.id.slice(0, 8),
    state: project.state,
  }));
}

export async function connectLinearProject(
  ctx: HandlerContext,
  input: {
    projectId: string;
    linearProjectId?: string;
    createName?: string;
  },
) {
  const project = await ctx.db.query.projects.findFirst({
    where: eq(projects.id, input.projectId),
  });

  if (!project) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Project not found" });
  }

  await assertWorkspaceAccess(ctx.db, ctx.userId, project.workspaceId);

  let linearProjectId = input.linearProjectId;

  if (!linearProjectId && input.createName) {
    const client = await getLinearClient(ctx.db, project.workspaceId);

    const integration = await ctx.db
      .select()
      .from(workspaceIntegrations)
      .where(
        and(
          eq(workspaceIntegrations.workspaceId, project.workspaceId),
          eq(workspaceIntegrations.provider, "linear"),
        ),
      )
      .then((rows) => rows[0]);

    const result = await client.createProject({
      name: input.createName,
      teamIds: integration?.linearTeamId ? [integration.linearTeamId] : [],
    });
    const created = await result.project;
    if (!created) {
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "Failed to create Linear project",
      });
    }
    linearProjectId = created.id;
  }

  if (!linearProjectId) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Must provide linearProjectId or createName",
    });
  }

  await ctx.db
    .update(projects)
    .set({
      planningProvider: "linear",
      linearProjectId,
    })
    .where(eq(projects.id, input.projectId));

  return { projectId: input.projectId, linearProjectId, planningProvider: "linear" as const };
}

/**
 * Create a Bob project for every Linear project in the workspace's team, and
 * import each project's existing open issues as work items.
 *
 * Idempotent: re-running only creates what's missing (matched on
 * linearProjectId / externalId). Synced projects default to autoDispatch=false
 * so they're visible on the Board without auto-spawning agent runs.
 */
export async function syncLinearProjects(
  ctx: HandlerContext,
  input: { workspaceId: string; importIssues?: boolean },
) {
  await assertWorkspaceAccess(ctx.db, ctx.userId, input.workspaceId);
  const client = await getLinearClient(ctx.db, input.workspaceId);

  // Owner used as the work-item owner for imported issues.
  const owner = await ctx.db.query.workspaceMembers.findFirst({
    where: eq(workspaceMembers.workspaceId, input.workspaceId),
    columns: { userId: true },
    orderBy: (m, { asc }) => [asc(m.joinedAt)],
  });
  if (!owner) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Workspace has no members" });
  }

  const importIssues = input.importIssues ?? true;

  let projectsCreated = 0;
  let projectsExisting = 0;
  let issuesImported = 0;
  let issuesUpdated = 0;
  let issuesTruncated = false;

  // One label lookup per pass: issues carry labelIds, and an `agent:<name>`
  // label pins the agent auto-drain uses for that card (see agentLabel.ts).
  const labelNameById = new Map<string, string>();
  try {
    const labels = await client.issueLabels({ first: 250 });
    for (const l of labels.nodes) labelNameById.set(l.id, l.name);
  } catch (err) {
    console.warn("[linear-sync] label lookup failed; agent overrides skipped this pass:", err);
  }
  const overrideFor = (issue: { labelIds?: string[] }) =>
    agentOverrideFromLabels((issue.labelIds ?? []).map((id) => labelNameById.get(id) ?? ""));

  const projectResult = await client.projects({ first: PROJECT_PAGE });
  const linearProjects = projectResult.nodes;
  const projectsTruncated = projectResult.pageInfo.hasNextPage;

  for (const lp of linearProjects) {
    const { project, created } = await ensureLinearProject(ctx.db, {
      workspaceId: input.workspaceId,
      linearProjectId: lp.id,
      name: lp.name,
      autoDispatch: false,
    });
    if (created) projectsCreated++;
    else projectsExisting++;

    if (!importIssues) continue;

    try {
      const issuesConn = await lp.issues({ first: ISSUE_PAGE });
      if (issuesConn.pageInfo.hasNextPage) issuesTruncated = true;

      for (const issue of issuesConn.nodes) {
        const state = await issue.state;
        const stateType = state?.type ?? "backlog";

        // Match BOTH external-id formats. Older rows were keyed by the Linear
        // identifier ("GMA-5"); this importer keys by the issue UUID. Checking
        // only the UUID never matches an identifier-keyed row, so every such
        // issue was re-imported and re-worked, producing duplicate PRs (the
        // "GMA-64" / "458f83a2-…" twins).
        const existing = await ctx.db.query.workItems.findFirst({
          where: and(
            inArray(
              workItems.externalId,
              [issue.id, issue.identifier].filter(
                (v): v is string => typeof v === "string" && v.length > 0,
              ),
            ),
            eq(workItems.externalProvider, "linear"),
          ),
          columns: { id: true, status: true, agentTypeOverride: true, sourceMetadata: true, queueSortOrder: true },
        });
        const labelOverride = overrideFor(issue);

        if (existing) {
          // Already imported: mirror the tracker's queue/closure state so a
          // card promoted Backlog→Todo (or closed) in Kanbanger reaches Bob.
          // The sync was insert-only before this, which left the tracker full
          // of Todo while Bob's dispatchable queue sat empty.
          const patch: Partial<typeof workItems.$inferInsert> = {};
          const next = reconcileImportedStatus(existing.status, stateType);
          if (next) patch.status = next;

          // Keep dispatch order in step with the tracker's priority so raising
          // a card to Urgent actually moves it up Bob's queue.
          const queueOrder = queueOrderForPriority(issue.priority);
          if (existing.queueSortOrder !== queueOrder) patch.queueSortOrder = queueOrder;

          // Keep the label-driven agent override in sync. Only overrides Bob
          // set FROM a label are cleared when the label goes away — a manual
          // override set in Bob's UI is left alone.
          const meta = { ...existing.sourceMetadata } as Record<string, unknown>;
          const fromLabel = meta.agentOverrideSource === "label";
          if (labelOverride && existing.agentTypeOverride !== labelOverride) {
            patch.agentTypeOverride = labelOverride;
            patch.sourceMetadata = { ...meta, agentOverrideSource: "label" };
          } else if (!labelOverride && fromLabel && existing.agentTypeOverride) {
            patch.agentTypeOverride = null;
            const { agentOverrideSource: _dropped, ...rest } = meta;
            patch.sourceMetadata = rest;
          }

          if (Object.keys(patch).length) {
            await ctx.db.update(workItems).set(patch).where(eq(workItems.id, existing.id));
            issuesUpdated++;
          }
          continue;
        }

        if (!isOpenLinearState(stateType)) continue;

        await ctx.db.insert(workItems).values({
          ownerUserId: owner.userId,
          workspaceId: input.workspaceId,
          projectId: project.id,
          kind: "task",
          title: (issue.title || "Untitled").slice(0, 256),
          description: issue.description ?? null,
          status: mapLinearStatusToBob(stateType),
          queueSortOrder: queueOrderForPriority(issue.priority),
          externalId: issue.id,
          externalProvider: "linear",
          externalUrl: issue.url,
          ...(labelOverride
            ? { agentTypeOverride: labelOverride, sourceMetadata: { agentOverrideSource: "label" } }
            : {}),
        });
        issuesImported++;
      }
    } catch (err) {
      console.error(
        `[linear-sync] Failed to import issues for project ${lp.name}:`,
        err,
      );
    }
  }

  // Record sync-health on the integration so it's visible in-app, not just in
  // cron console logs.
  const syncResult = `${projectsCreated} created · ${projectsExisting} existing · ${issuesImported} issues imported · ${issuesUpdated} updated`;
  await ctx.db
    .update(workspaceIntegrations)
    .set({
      lastSyncedAt: new Date().toISOString(),
      lastSyncResult: syncResult,
    })
    .where(
      and(
        eq(workspaceIntegrations.workspaceId, input.workspaceId),
        eq(workspaceIntegrations.provider, "linear"),
      ),
    );

  return {
    projectsCreated,
    projectsExisting,
    issuesImported,
    issuesUpdated,
    projectsTruncated,
    issuesTruncated,
  };
}
