/**
 * Linear setup handler functions — list and connect Linear projects to Bob
 * projects.
 *
 * Phase 7B-4D-beta Task 7.
 */
import { TRPCError } from "@trpc/server";
import { eq, and } from "@bob/db";
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

import type { HandlerContext } from "./context.js";

/** Max Linear projects / issues-per-project pulled in a single sync pass. */
const PROJECT_PAGE = 100;
const ISSUE_PAGE = 100;

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

async function getLinearClient(db: any, workspaceId: string): Promise<LinearClient> {
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
    .then((rows: any[]) => rows[0]);

  if (!integration?.apiKey) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "Linear integration not configured. Set up an API key first.",
    });
  }

  return new LinearClient({ apiKey: integration.apiKey });
}

async function assertWorkspaceAccess(db: any, userId: string, workspaceId: string) {
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
  return result.nodes.map((project: any) => ({
    id: project.id,
    name: project.name,
    key: project.slugId ?? project.id.slice(0, 8),
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
      .then((rows: any[]) => rows[0]);

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
    orderBy: (m: any, { asc }: any) => [asc(m.joinedAt)],
  });
  if (!owner) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Workspace has no members" });
  }

  const importIssues = input.importIssues ?? true;

  let projectsCreated = 0;
  let projectsExisting = 0;
  let issuesImported = 0;
  let issuesTruncated = false;

  const projectResult = await client.projects({ first: PROJECT_PAGE });
  const linearProjects = projectResult.nodes;
  const projectsTruncated = projectResult.pageInfo?.hasNextPage ?? false;

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
      if (issuesConn.pageInfo?.hasNextPage) issuesTruncated = true;

      for (const issue of issuesConn.nodes) {
        const state = await issue.state;
        const stateType = state?.type ?? "backlog";
        if (!isOpenLinearState(stateType)) continue;

        const existing = await ctx.db.query.workItems.findFirst({
          where: and(
            eq(workItems.externalId, issue.id),
            eq(workItems.externalProvider, "linear"),
          ),
          columns: { id: true },
        });
        if (existing) continue;

        await ctx.db.insert(workItems).values({
          ownerUserId: owner.userId,
          workspaceId: input.workspaceId,
          projectId: project.id,
          kind: "task",
          title: (issue.title ?? "Untitled").slice(0, 256),
          description: issue.description ?? null,
          status: mapLinearStatusToBob(stateType),
          externalId: issue.id,
          externalProvider: "linear",
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

  return {
    projectsCreated,
    projectsExisting,
    issuesImported,
    projectsTruncated,
    issuesTruncated,
  };
}
