import {
  type Database,
  activities,
  forgeBuilds,
  forgeDeployments,
  issueGitLinks,
  issues,
  projects,
} from "@linear-clone/db";
import { and, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { protectedProcedure, router } from "../trpc";
import { buildIssuePayload, dispatchWebhook } from "../services/outbound-webhook";

export const forgeDeploymentCreateInputSchema = z.object({
  repoId: z.string().min(1),
  revId: z.string().min(1),
  buildId: z.string().uuid(),
  environment: z.enum(["dev", "staging", "prod", "preview"]),
  rollbackTargetDeploymentId: z.string().uuid().optional(),
});

export const forgeDeploymentUpdateStatusInputSchema = z.object({
  deploymentId: z.string().uuid(),
  status: z.enum([
    "pending_approval",
    "queued",
    "building",
    "testing",
    "verifying",
    "deploying",
    "healthy",
    "unhealthy",
    "rolled_back",
    "failed",
  ]),
});

type DeploymentStatus =
  | "pending_approval"
  | "queued"
  | "building"
  | "testing"
  | "verifying"
  | "deploying"
  | "healthy"
  | "unhealthy"
  | "rolled_back"
  | "failed";

const DEPLOYMENT_TRANSITIONS: Record<DeploymentStatus, DeploymentStatus[]> = {
  pending_approval: ["queued", "building", "testing", "deploying", "verifying", "failed"],
  queued: ["building", "deploying", "failed"],
  building: ["testing", "deploying", "failed"],
  testing: ["deploying", "verifying", "failed"],
  deploying: ["verifying", "healthy", "unhealthy", "failed", "rolled_back"],
  verifying: ["healthy", "unhealthy", "rolled_back", "failed"],
  healthy: ["rolled_back"],
  unhealthy: ["rolled_back", "failed"],
  rolled_back: [],
  failed: [],
};

export function canTransitionDeploymentStatus(
  from: DeploymentStatus,
  to: DeploymentStatus
) {
  return DEPLOYMENT_TRANSITIONS[from].includes(to);
}

function dedupeStrings(values: string[]) {
  return [...new Set(values)];
}

function deriveIssueFunnelStageFromDeployment(
  environment: "dev" | "staging" | "prod" | "preview",
  status: DeploymentStatus
): (typeof issues.$inferSelect["funnelStage"]) | null {
  if (environment === "staging") {
    if (status === "healthy") return "staging_deployed";
    if (status === "verifying") return "staging_verified";
    return null;
  }

  if (environment === "prod" && status === "healthy") {
    return "production_deployed";
  }

  if (environment === "prod" && status === "rolled_back") {
    return "staging_verified";
  }

  return null;
}

async function resolveIssueIdsForDeployment(
  db: Database,
  buildId: string,
  revision: string
) {
  const issueIds = new Set<string>();

  const [build] = await db
    .select({ taskId: forgeBuilds.taskId })
    .from(forgeBuilds)
    .where(eq(forgeBuilds.id, buildId))
    .limit(1);

  if (build?.taskId) {
    issueIds.add(build.taskId);
  }

  const linkedRows = await db
    .select({ issueId: issueGitLinks.issueId })
    .from(issueGitLinks)
    .where(and(eq(issueGitLinks.type, "commit"), eq(issueGitLinks.externalId, revision)));

  for (const linkedRow of linkedRows) {
    issueIds.add(linkedRow.issueId);
  }

  return dedupeStrings([...issueIds]);
}

export async function syncIssueFunnelStageFromDeployment(
  db: Database,
  deployment: {
    id: string;
    buildId: string;
    revId: string;
    environment: "dev" | "staging" | "prod" | "preview";
    status: DeploymentStatus;
  },
  issueIds?: string[]
): Promise<void> {
  const nextFunnelStage = deriveIssueFunnelStageFromDeployment(
    deployment.environment,
    deployment.status
  );

  if (!nextFunnelStage) {
    return;
  }

  const resolvedIssueIds = dedupeStrings(
    issueIds && issueIds.length > 0
      ? issueIds
      : await resolveIssueIdsForDeployment(db, deployment.buildId, deployment.revId)
  );

  if (resolvedIssueIds.length === 0) {
    return;
  }

  const issuesToSync = await db
    .select()
    .from(issues)
    .where(inArray(issues.id, resolvedIssueIds));

  if (issuesToSync.length === 0) {
    return;
  }

  for (const currentIssue of issuesToSync) {
    if (currentIssue.funnelStage === nextFunnelStage) {
      continue;
    }

    const [updatedIssue] = await db
      .update(issues)
      .set({ funnelStage: nextFunnelStage, updatedAt: new Date() })
      .where(eq(issues.id, currentIssue.id))
      .returning();

    if (!updatedIssue) {
      continue;
    }

    await db.insert(activities).values({
      issueId: currentIssue.id,
      type: "funnel_stage_changed",
      fromValue: currentIssue.funnelStage,
      toValue: nextFunnelStage,
      changes: {
        field: "funnelStage",
        from: currentIssue.funnelStage,
        to: nextFunnelStage,
        reason: "deployment_status_update",
        deploymentId: deployment.id,
      },
    });

    const [project] = await db
      .select({ workspaceId: projects.workspaceId })
      .from(projects)
      .where(eq(projects.id, updatedIssue.projectId))
      .limit(1);

    if (!project) {
      continue;
    }

    await dispatchWebhook(
      db,
      project.workspaceId,
      updatedIssue.projectId,
      "issue.funnel_stage_changed",
      buildIssuePayload(updatedIssue),
      {
        field: "funnelStage",
        from: currentIssue.funnelStage,
        to: nextFunnelStage,
      }
    ).catch(() => {});
  }
}

export const forgeDeploymentRouter = router({
  create: protectedProcedure
    .input(forgeDeploymentCreateInputSchema)
    .mutation(async ({ ctx, input }) => {
      const [deployment] = await ctx.db
        .insert(forgeDeployments)
        .values({
          repoId: input.repoId,
          revId: input.revId,
          buildId: input.buildId,
          environment: input.environment,
          rollbackTargetDeploymentId: input.rollbackTargetDeploymentId,
          status: "pending_approval",
        })
        .returning();

      return deployment;
    }),

  get: protectedProcedure
    .input(z.object({ deploymentId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const [deployment] = await ctx.db
        .select()
        .from(forgeDeployments)
        .where(eq(forgeDeployments.id, input.deploymentId))
        .limit(1);

      return deployment ?? null;
    }),

  listByEnvironment: protectedProcedure
    .input(
      z.object({
        environment: z.enum(["dev", "staging", "prod", "preview"]),
        limit: z.number().int().min(1).max(100).default(20),
      })
    )
    .query(async ({ ctx, input }) => {
      return ctx.db
        .select()
        .from(forgeDeployments)
        .where(eq(forgeDeployments.environment, input.environment))
        .orderBy(desc(forgeDeployments.createdAt))
        .limit(input.limit);
    }),

  updateStatus: protectedProcedure
    .input(forgeDeploymentUpdateStatusInputSchema)
    .mutation(async ({ ctx, input }) => {
      const [existing] = await ctx.db
        .select()
        .from(forgeDeployments)
        .where(eq(forgeDeployments.id, input.deploymentId))
        .limit(1);

      if (!existing) {
        throw new Error("Deployment not found");
      }

      if (!canTransitionDeploymentStatus(existing.status, input.status)) {
        throw new Error(`Invalid deployment status transition: ${existing.status} -> ${input.status}`);
      }

      const [updated] = await ctx.db
        .update(forgeDeployments)
        .set({
          status: input.status,
          deployedAt:
            input.status === "healthy" || input.status === "rolled_back"
              ? new Date()
              : undefined,
          updatedAt: new Date(),
        })
          .where(eq(forgeDeployments.id, input.deploymentId))
          .returning();

      if (updated) {
        await syncIssueFunnelStageFromDeployment(ctx.db, updated);
      }

      return updated;
    }),
});
