/**
 * Linear setup handler functions — list and connect Linear projects to Bob
 * projects.
 *
 * Phase 7B-4D-beta Task 7.
 */
import { TRPCError } from "@trpc/server";
import { eq, and } from "@bob/db";
import { projects, workspaceIntegrations, workspaceMembers } from "@bob/db/schema";
import { LinearClient } from "@linear/sdk";

import type { HandlerContext } from "./context.js";

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
