import { NextRequest, NextResponse } from "next/server";
import { and, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { createContext } from "@linear-clone/api";
import { buildIssuePayload, dispatchWebhook } from "@linear-clone/api";
import {
  type Database,
  forgeBuildArtifacts,
  activities,
  forgeBuilds,
  forgeDeployments,
  issues,
  issueGitLinks,
  projects,
} from "@linear-clone/db";

const _deploymentStatusValues = [
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
] as const;
type DeploymentStatus = (typeof _deploymentStatusValues)[number];

const deploymentEnvironmentSchema = z.enum(["dev", "staging", "production", "preview"]);
const _canonicalDeploymentEnvironmentSchema = z.enum(["dev", "staging", "prod", "preview"]);
const deploymentFunnelStageOrder = [
  "dumped",
  "triaged",
  "planned",
  "designed",
  "ready_for_execution",
  "picked_up",
  "staging_deployed",
  "staging_verified",
  "production_deployed",
] as const;

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

type LegacyEnvironment = z.infer<typeof deploymentEnvironmentSchema>;
type CanonicalEnvironment = z.infer<typeof _canonicalDeploymentEnvironmentSchema>;

function normalizeDeploymentEnvironment(
  environment: LegacyEnvironment
): CanonicalEnvironment {
  if (environment === "production") {
    return "prod";
  }

  return environment;
}

function canTransitionDeploymentStatus(
  from: DeploymentStatus,
  to: DeploymentStatus
) {
  return DEPLOYMENT_TRANSITIONS[from].includes(to);
}

function normalizeDeploymentStatus(value: string): DeploymentStatus | null {
  const status = value.toLowerCase().trim();

  if (status === "pending_approval" || status === "pending") return "pending_approval";
  if (status === "queued" || status === "queue" || status === "scheduled") return "queued";
  if (status === "running" || status === "build" || status === "building" || status === "started") return "building";
  if (status === "testing" || status === "validate" || status === "validation") return "testing";
  if (status === "verifying" || status === "verify") return "verifying";
  if (status === "deploying" || status === "deploy" || status === "in_progress" || status === "deploying_to_k8s") return "deploying";
  if (
    status === "healthy" ||
    status === "passed" ||
    status === "success" ||
    status === "succeeded"
  ) {
    return "healthy";
  }
  if (status === "unhealthy" || status === "degraded") return "unhealthy";
  if (status === "rolled_back" || status === "rollback" || status === "rolledback") return "rolled_back";
  if (status === "failed" || status === "failure" || status === "error" || status === "canceled" || status === "cancelled") {
    return "failed";
  }

  return null;
}

function deriveIssueFunnelStageFromDeployment(
  environment: CanonicalEnvironment,
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

function shouldAdvanceIssueFunnelStage({
  current,
  next,
  deployment,
}: {
  current: string;
  next: string;
  deployment: {
    environment: CanonicalEnvironment;
    status: DeploymentStatus;
  };
}): boolean {
  if (current === next) {
    return false;
  }

  const currentIndex = deploymentFunnelStageOrder.indexOf(current as unknown as typeof deploymentFunnelStageOrder[number]);
  const nextIndex = deploymentFunnelStageOrder.indexOf(next as unknown as typeof deploymentFunnelStageOrder[number]);

  if (currentIndex === -1 || nextIndex === -1) {
    return true;
  }

  if (nextIndex > currentIndex) {
    return true;
  }

  if (
    deployment.environment === "prod" &&
    deployment.status === "rolled_back" &&
    current === "production_deployed" &&
    next === "staging_verified"
  ) {
    return true;
  }

  return false;
}

function normalizeOptionalStringArray(values: string[] | undefined): string[] {
  if (!values || values.length === 0) {
    return [];
  }

  return [...new Set(
    values
      .filter((value): value is string => typeof value === "string")
      .map((value) => value.trim())
      .filter((value) => value.length > 0)
  )];
}

function normalizeOptionalUuidArray(values: string[] | undefined): string[] {
  return normalizeOptionalStringArray(values).filter((value) => z.string().uuid().safeParse(value).success);
}

function normalizeOptionalValues(values: Array<string | undefined>): string[] {
  return normalizeOptionalStringArray(values.filter((value): value is string => typeof value === "string"));
}

export async function resolveIssueIdsForDeploymentPayload(db: Database, payload: {
  buildId: string;
  issueIds?: string[];
  issueIdentifiers?: string[];
  commitIds?: string[];
  revId: string;
  imageTag?: string;
  imageDigest?: string;
}) {
  const issueIds = new Set<string>(normalizeOptionalUuidArray(payload.issueIds));

  const issueIdentifiers = normalizeOptionalStringArray(payload.issueIdentifiers);
  if (issueIdentifiers.length > 0) {
    const identifierRows = await db
      .select({ id: issues.id })
      .from(issues)
      .where(inArray(issues.identifier, issueIdentifiers));

    for (const row of identifierRows) {
      issueIds.add(row.id);
    }
  }

  const commitRefs = normalizeOptionalStringArray([
    ...normalizeOptionalStringArray(payload.commitIds),
    payload.revId,
    ...normalizeOptionalValues([payload.imageTag, payload.imageDigest]),
  ]);

  if (commitRefs.length > 0) {
    const linkedRows = await db
      .select({ issueId: issueGitLinks.issueId })
      .from(issueGitLinks)
      .where(and(eq(issueGitLinks.type, "commit"), inArray(issueGitLinks.externalId, commitRefs)));

    for (const row of linkedRows) {
      issueIds.add(row.issueId);
    }
  }

  const [build] = await db
    .select({ taskId: forgeBuilds.taskId })
    .from(forgeBuilds)
    .where(eq(forgeBuilds.id, payload.buildId))
    .limit(1);

  if (build?.taskId) {
    issueIds.add(build.taskId);
  }

  return [...issueIds];
}

export async function syncIssueFunnelStageFromDeployment(
  db: Database,
  deployment: {
    id: string;
    environment: CanonicalEnvironment;
    status: DeploymentStatus;
  },
  issueIds: string[]
) {
  const nextFunnelStage = deriveIssueFunnelStageFromDeployment(deployment.environment, deployment.status);
  if (!nextFunnelStage || issueIds.length === 0) {
    return;
  }

  const issuesToSync = await db
    .select()
    .from(issues)
    .where(inArray(issues.id, issueIds));

  for (const existingIssue of issuesToSync) {
    if (!shouldAdvanceIssueFunnelStage({
      current: existingIssue.funnelStage,
      next: nextFunnelStage,
      deployment: {
        environment: deployment.environment,
        status: deployment.status,
      },
    })) {
      continue;
    }

    const [updatedIssue] = await db
      .update(issues)
      .set({
        funnelStage: nextFunnelStage,
        updatedAt: new Date(),
      })
      .where(eq(issues.id, existingIssue.id))
      .returning();

    if (!updatedIssue) {
      continue;
    }

    await db.insert(activities).values({
      issueId: updatedIssue.id,
      type: "funnel_stage_changed",
      fromValue: existingIssue.funnelStage,
      toValue: nextFunnelStage,
      changes: {
        field: "funnelStage",
        from: existingIssue.funnelStage,
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
        from: existingIssue.funnelStage,
        to: nextFunnelStage,
      }
    ).catch(() => {});
  }
}

const deploymentStatusInputSchema = z.object({
  repoId: z.string().min(1),
  revId: z.string().min(1),
  environment: deploymentEnvironmentSchema.default("production"),
  status: z.string().min(1),
  runId: z.string().optional(),
  imageTag: z.string().optional(),
  imageDigest: z.string().optional(),
  rollbackDeploymentId: z.string().uuid().optional(),
  metadata: z.record(z.unknown()).optional(),
  issueIds: z.array(z.string().uuid()).optional(),
  issueIdentifiers: z.array(z.string().max(255)).optional(),
  commitIds: z.array(z.string().max(255)).optional(),
});

function getRequestToken(request: NextRequest) {
  const authorizationHeader = request.headers.get("authorization");
  if (authorizationHeader?.toLowerCase().startsWith("bearer ")) {
    return authorizationHeader.slice("bearer ".length).trim();
  }
  return request.headers.get("x-api-key")?.trim();
}

async function resolveBuildForDeployment(
  ctxDb: Database,
  payload: {
    repoId: string;
    revId: string;
    runId?: string;
    imageTag?: string;
  }
) {
  const conditions = [eq(forgeBuilds.repoId, payload.repoId), eq(forgeBuilds.revId, payload.revId)];

  if (payload.runId) {
    conditions.push(eq(forgeBuilds.runId, payload.runId));
  }

  if (payload.imageTag) {
    conditions.push(eq(forgeBuilds.imageDigest, payload.imageTag));
  }

  const [directMatch] = await ctxDb
    .select()
    .from(forgeBuilds)
    .where(and(...conditions))
    .orderBy(desc(forgeBuilds.createdAt))
    .limit(1);

  if (directMatch) {
    return directMatch;
  }

  if (!payload.imageTag) {
    return null;
  }

  const [artifactMatch] = await ctxDb
    .select({ buildId: forgeBuildArtifacts.buildId })
    .from(forgeBuildArtifacts)
    .where(and(eq(forgeBuildArtifacts.storageKey, payload.imageTag), eq(forgeBuildArtifacts.type, "container_image")))
    .orderBy(desc(forgeBuildArtifacts.createdAt))
    .limit(1);

  if (!artifactMatch?.buildId) {
    return null;
  }

  const [buildFromArtifact] = await ctxDb
    .select()
    .from(forgeBuilds)
    .where(eq(forgeBuilds.id, artifactMatch.buildId))
    .limit(1);

  if (!buildFromArtifact) {
    return null;
  }

  return buildFromArtifact;
}

async function resolveDeployment(
  ctxDb: Database,
  repoId: string,
  environment: CanonicalEnvironment,
  buildId: string,
  revId: string
) {
  const [exactMatch] = await ctxDb
    .select()
    .from(forgeDeployments)
    .where(
      and(
        eq(forgeDeployments.repoId, repoId),
        eq(forgeDeployments.environment, environment),
        eq(forgeDeployments.buildId, buildId),
        eq(forgeDeployments.revId, revId)
      )
    )
    .orderBy(desc(forgeDeployments.createdAt))
    .limit(1);

  if (exactMatch) {
    return exactMatch;
  }

  const [latestInEnv] = await ctxDb
    .select()
    .from(forgeDeployments)
    .where(and(eq(forgeDeployments.repoId, repoId), eq(forgeDeployments.environment, environment), eq(forgeDeployments.revId, revId)))
    .orderBy(desc(forgeDeployments.createdAt))
    .limit(1);

  return latestInEnv;
}

export async function POST(request: NextRequest) {
  const token = getRequestToken(request);
  if (!token) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const parsedBody = deploymentStatusInputSchema.safeParse(await request.json().catch(() => null));
  if (!parsedBody.success) {
    return NextResponse.json({ error: "Invalid payload", details: parsedBody.error.flatten() }, { status: 400 });
  }

  const payload = parsedBody.data;
  const normalizedStatus = normalizeDeploymentStatus(payload.status);
  if (!normalizedStatus) {
    return NextResponse.json({ error: "Invalid status", status: payload.status }, { status: 400 });
  }

  const normalizedEnvironment = normalizeDeploymentEnvironment(payload.environment);

  const ctx = await createContext({
    req: {
      headers: {
        authorization: `Bearer ${token}`,
      },
    },
  });

  if (!ctx.userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const build = await resolveBuildForDeployment(ctx.db, {
    repoId: payload.repoId,
    revId: payload.revId,
    runId: payload.runId,
    imageTag: payload.imageTag ?? payload.imageDigest,
  });
  if (!build) {
    return NextResponse.json(
      { error: "Unable to resolve build for deployment status update" },
      { status: 404 }
    );
  }

  const issueIds = await resolveIssueIdsForDeploymentPayload(ctx.db, {
    buildId: build.id,
    issueIds: payload.issueIds,
    issueIdentifiers: payload.issueIdentifiers,
    commitIds: payload.commitIds,
    revId: payload.revId,
    imageTag: payload.imageTag,
    imageDigest: payload.imageDigest,
  });

  const existing = await resolveDeployment(
    ctx.db,
    payload.repoId,
    normalizedEnvironment,
    build.id,
    payload.revId
  );

  if (!existing) {
    const [created] = await ctx.db
      .insert(forgeDeployments)
      .values({
        repoId: payload.repoId,
        revId: payload.revId,
        buildId: build.id,
        environment: normalizedEnvironment,
        status: normalizedStatus,
        rollbackTargetDeploymentId: payload.rollbackDeploymentId ?? null,
        deployedAt:
          normalizedStatus === "healthy" || normalizedStatus === "rolled_back"
            ? new Date()
            : null,
      })
      .returning();

    if (!created) {
      return NextResponse.json(
        { error: "Failed to create deployment" },
        { status: 500 }
      );
    }

    await syncIssueFunnelStageFromDeployment(ctx.db, created, issueIds);

    return NextResponse.json(
      {
        ok: true,
        idempotent: false,
        created: true,
        deploymentId: created.id,
        status: created.status,
        environment: normalizedEnvironment,
      },
      { status: 201 }
    );
  }

  if (existing.status === normalizedStatus) {
    return NextResponse.json({
      ok: true,
      idempotent: true,
      created: false,
      deploymentId: existing.id,
      status: existing.status,
      environment: normalizedEnvironment,
    });
  }

  if (!canTransitionDeploymentStatus(existing.status, normalizedStatus)) {
    return NextResponse.json(
      {
        error: "Invalid deployment status transition",
        from: existing.status,
        to: normalizedStatus,
      },
      { status: 409 }
    );
  }

  const deployedAt =
    normalizedStatus === "healthy" || normalizedStatus === "rolled_back"
      ? new Date()
      : existing.deployedAt;

  const [updated] = await ctx.db
    .update(forgeDeployments)
    .set({
      status: normalizedStatus,
      deployedAt,
      rollbackTargetDeploymentId:
        normalizedStatus === "rolled_back"
          ? (payload.rollbackDeploymentId ?? existing.rollbackTargetDeploymentId ?? null)
          : existing.rollbackTargetDeploymentId,
      updatedAt: new Date(),
    })
    .where(eq(forgeDeployments.id, existing.id))
    .returning();

  if (!updated) {
    return NextResponse.json({ error: "Failed to update deployment" }, { status: 500 });
  }

  await syncIssueFunnelStageFromDeployment(ctx.db, updated, issueIds);

  return NextResponse.json({
    ok: true,
    idempotent: false,
    created: false,
    deploymentId: updated.id,
    status: updated.status,
    environment: normalizedEnvironment,
  });
}

export async function GET() {
  return NextResponse.json({ status: "ok", endpoint: "forge-deployment-status-legacy" });
}
