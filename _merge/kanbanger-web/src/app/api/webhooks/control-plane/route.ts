import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { and, desc, eq, inArray, ne } from "drizzle-orm";
import { z } from "zod";
import {
  type Database,
  activities,
  db,
  forgeBuilds,
  forgeDeployments,
  forgeRepositories,
  issueGitLinks,
  issues,
  projects,
  webhookDeliveries,
} from "@linear-clone/db";
import { buildIssuePayload, dispatchWebhook } from "@linear-clone/api";

const controlPlaneRollbackDedupe = new Map<string, number>();
let controlPlaneWebhookDbOverride: Database | null = null;

function getWebhookDb() {
  return controlPlaneWebhookDbOverride ?? db;
}

export function setControlPlaneWebhookDb(database: Database | null) {
  controlPlaneWebhookDbOverride = database;
}

function getRollbackDedupeWindowMs() {
  const configured = Number.parseInt(
    process.env.FORGEGRAPH_CONTROL_PLANE_ROLLBACK_DEDUPE_WINDOW_MS ??
      process.env.FORGEGRAPH_WEBHOOK_DEDUPE_WINDOW_MS ??
      process.env.FORGEGRAPH_CONTROL_PLANE_WEBHOOK_DEDUPE_MS ??
      "300000",
    10
  );

  if (Number.isNaN(configured) || configured <= 0) {
    return 5 * 60 * 1000;
  }

  return configured;
}

function cleanupControlPlaneRollbackDedupe(now: number) {
  for (const [key, expiryMs] of controlPlaneRollbackDedupe.entries()) {
    if (expiryMs <= now) {
      controlPlaneRollbackDedupe.delete(key);
    }
  }
}

function hasRecentControlPlaneRollback(dedupeKey: string) {
  const now = Date.now();
  cleanupControlPlaneRollbackDedupe(now);

  const existing = controlPlaneRollbackDedupe.get(dedupeKey);
  if (existing && existing > now) {
    return true;
  }

  const expiresAt = now + getRollbackDedupeWindowMs();
  controlPlaneRollbackDedupe.set(dedupeKey, expiresAt);
  return false;
}

function dedupeControlPlaneRollback(event: {
  sourceDeploymentId?: string;
  sourceRevision?: string;
  rollbackDeploymentId?: string;
  rollbackImageTag?: string;
  repoId?: string;
  repoName?: string;
  environment?: string;
  workspaceId?: string;
}) {
  return [
    event.workspaceId,
    event.repoId,
    event.repoName,
    event.environment,
    event.sourceDeploymentId,
    event.sourceRevision,
    event.rollbackDeploymentId,
    event.rollbackImageTag,
  ]
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .join("|");
}

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

const deploymentEnvironmentSchema = z
  .enum(["dev", "staging", "production", "preview", "prod"])
  .transform((environment) => (environment === "prod" ? "production" : environment));
const _canonicalDeploymentEnvironmentSchema = z.enum(["dev", "staging", "prod", "preview"]);

function normalizeDeploymentEnvironment(
  environment: z.infer<typeof deploymentEnvironmentSchema>
): z.infer<typeof _canonicalDeploymentEnvironmentSchema> {
  if (environment === "production") {
    return "prod";
  }

  return environment;
}

function resolveAlertManagerEnvironment(
  value: string | undefined,
  namespace: string | undefined,
): "dev" | "staging" | "production" | "preview" {
  const normalizedValue = value?.toLowerCase();
  if (normalizedValue) {
    if (normalizedValue === "prod" || normalizedValue === "production") return "production";
    if (normalizedValue === "staging") return "staging";
    if (normalizedValue === "dev") return "dev";
  }

  if (namespace?.includes("prod")) {
    return "production";
  }

  if (namespace?.includes("staging")) {
    return "staging";
  }

  return "staging";
}

const controlPlaneRollbackEventBaseSchema = z.object({
  source: z
    .enum(["control-plane", "alertmanager"])
    .default("control-plane"),
  repoId: z.string().uuid().optional(),
  repoName: z.string().min(1).optional(),
  workspaceId: z.string().uuid().optional(),
  environment: deploymentEnvironmentSchema.default("production"),
  sourceDeploymentId: z.string().uuid().optional(),
  sourceRevision: z.string().min(1).optional(),
  rollbackDeploymentId: z.string().uuid().optional(),
  rollbackImageTag: z.string().min(1).optional(),
  issueIds: z.array(z.string().uuid()).optional(),
  issueIdentifiers: z.array(z.string().max(255)).optional(),
  commitIds: z.array(z.string().max(255)).optional(),
  reason: z.string().max(5000).optional(),
  metadata: z.record(z.unknown()).optional(),
});

const controlPlaneRollbackEventSchema = controlPlaneRollbackEventBaseSchema.refine(
  (value) => Boolean(value.repoId || value.repoName),
  {
    message: "Either repoId or repoName is required.",
    path: ["repoId"],
  }
);

function firstNonEmptyString(...values: Array<string | undefined>): string | undefined {
  return values.find((value): value is string => typeof value === "string" && value.trim().length > 0);
}

function normalizeOptionalStringArray(values: Array<string | undefined> | string[] | undefined): string[] {
  if (!values || values.length === 0) {
    return [];
  }

  const normalizedValues: string[] = [];
  for (const value of values) {
    if (typeof value === "string") {
      const next = value.trim();
      if (next.length > 0) {
        normalizedValues.push(next);
      }
    }
  }

  return [...new Set(normalizedValues)];
}

function getActiveWebhookToken() {
  return [
    process.env.FORGEGRAPH_CONTROL_PLANE_WEBHOOK_TOKEN,
    process.env.CONTROL_PLANE_WEBHOOK_TOKEN,
    process.env.PROMETHEUS_WEBHOOK_TOKEN,
    process.env.PROMETHEUS_BEARER_TOKEN,
  ].find((token) => typeof token === "string" && token.trim().length > 0);
}

function normalizeSafeParseError(error: unknown): {
  formErrors: string[];
  fieldErrors: Record<string, unknown>;
} {
  if (
    typeof error === "object" &&
    error !== null &&
    "flatten" in error &&
    typeof (error as { flatten?: unknown }).flatten === "function"
  ) {
    const parsed = (error as {
      flatten: () => {
        formErrors: string[];
        fieldErrors: Record<string, unknown>;
      };
    }).flatten();
    return {
      formErrors: parsed.formErrors ?? [],
      fieldErrors: parsed.fieldErrors ?? {},
    };
  }

  return { formErrors: [String(error)], fieldErrors: {} };
}

function normalizeOptionalUuidArray(values: string[] | undefined): string[] {
  return normalizeOptionalStringArray(values).filter((value) => z.string().uuid().safeParse(value).success);
}

const alertManagerRollbackSchema = controlPlaneRollbackEventBaseSchema
  .omit({ source: true, reason: true })
  .partial();

const alertManagerWebhookPayloadSchema = z.object({
  alerts: z
    .array(
      z.object({
        labels: z.record(z.string()).default({}),
        annotations: z.record(z.string()).default({}),
        fingerprint: z.string().optional(),
      })
    )
    .min(1),
  status: z.string().optional(),
  receiver: z.string().optional(),
});

const alertManagerWebhookSchema = alertManagerWebhookPayloadSchema
  .transform((payload) => {
    const firstAlert = payload.alerts[0];
    if (!firstAlert) {
      throw new Error("Missing alert payload");
    }

    const labels = firstAlert.labels;
    const annotations = firstAlert.annotations;

    const repoName =
      labels.repository ??
      labels.repo ??
      labels.project ??
      undefined;

    const resolvedEnvironment = resolveAlertManagerEnvironment(
      labels.environment,
      labels.namespace
    );

    return {
      source: "alertmanager" as const,
      repoName,
      environment: resolvedEnvironment,
      sourceDeploymentId: undefined as string | undefined,
      sourceRevision: labels.source_revision,
      rollbackDeploymentId: undefined as string | undefined,
      rollbackImageTag:
        annotations.rollback_image_tag ??
        annotations.rollbackImage ??
        labels.rollback_image_tag ??
        labels.rollback_image ??
        undefined,
      reason:
        firstNonEmptyString(
          annotations.reason,
          labels.reason,
          `${payload.receiver ? `receiver=${payload.receiver}` : "alertmanager"}`
        ),
      metadata: {
        alertmanager: {
          status: payload.status,
          alerts: payload.alerts,
        },
      },
    };
  })
  .pipe(
    alertManagerRollbackSchema
  );

const controlPlaneWebhookSchema = z.union([
  controlPlaneRollbackEventSchema,
  alertManagerWebhookSchema,
]);

type ControlPlaneWebhookEvent = z.infer<typeof controlPlaneRollbackEventSchema> & {
  source: "control-plane" | "alertmanager";
};

function getRequestToken(request: NextRequest) {
  const authorizationHeader = request.headers.get("authorization");
  if (authorizationHeader?.toLowerCase().startsWith("bearer ")) {
    return authorizationHeader.slice("bearer ".length).trim();
  }

  return request.headers.get("x-webhook-token")?.trim();
}

function buildResponseBody(message: string, payload: Record<string, unknown>, detail?: Record<string, unknown>) {
  return JSON.stringify({
    message,
    ...detail,
    payload,
  });
}

async function resolveRepositoryId(event: ControlPlaneWebhookEvent): Promise<string | null> {
  const database = getWebhookDb();
  if (event.repoId) {
    return event.repoId;
  }

  const clauses = [eq(forgeRepositories.name, event.repoName ?? "")];
  if (event.workspaceId) {
    clauses.push(eq(forgeRepositories.workspaceId, event.workspaceId));
  }

  const repos = await database
    .select({ id: forgeRepositories.id, name: forgeRepositories.name })
    .from(forgeRepositories)
    .where(clauses.length === 1 ? clauses[0] : and(...clauses))
    .limit(2);

  if (repos.length !== 1) {
    return null;
  }

  return repos[0]?.id ?? null;
}

async function resolveSourceDeployment(
  repoId: string,
  environment: z.infer<typeof _canonicalDeploymentEnvironmentSchema>,
  event: ControlPlaneWebhookEvent
) {
  const database = getWebhookDb();
  if (event.sourceDeploymentId) {
    const [record] = await database
      .select()
      .from(forgeDeployments)
      .where(eq(forgeDeployments.id, event.sourceDeploymentId))
      .limit(1);

    if (record?.repoId === repoId) {
      return record;
    }
  }

  if (event.sourceRevision) {
    const [record] = await database
      .select()
      .from(forgeDeployments)
      .where(
        and(
          eq(forgeDeployments.repoId, repoId),
          eq(forgeDeployments.environment, environment),
          eq(forgeDeployments.revId, event.sourceRevision)
        )
      )
      .orderBy(desc(forgeDeployments.createdAt))
      .limit(1);

    if (record) {
      return record;
    }
  }

  const [record] = await database
    .select()
    .from(forgeDeployments)
    .where(
      and(
        eq(forgeDeployments.repoId, repoId),
        eq(forgeDeployments.environment, environment),
        ne(forgeDeployments.status, "rolled_back")
      )
    )
    .orderBy(desc(forgeDeployments.createdAt))
    .limit(1);

  return record;
}

async function resolveRollbackTargetDeployment(
  repoId: string,
  environment: z.infer<typeof _canonicalDeploymentEnvironmentSchema>,
  event: ControlPlaneWebhookEvent
) {
  const database = getWebhookDb();
  if (event.rollbackDeploymentId) {
    const [record] = await database
      .select()
      .from(forgeDeployments)
      .where(
        and(
          eq(forgeDeployments.id, event.rollbackDeploymentId),
          eq(forgeDeployments.repoId, repoId),
          eq(forgeDeployments.environment, environment)
        )
      )
      .limit(1);

    if (record) {
      return record;
    }
  }

  if (event.rollbackImageTag) {
    const [record] = await database
      .select()
      .from(forgeDeployments)
      .where(
        and(
          eq(forgeDeployments.repoId, repoId),
          eq(forgeDeployments.environment, environment),
          eq(forgeDeployments.revId, event.rollbackImageTag),
          eq(forgeDeployments.status, "healthy")
        )
      )
      .orderBy(desc(forgeDeployments.createdAt))
      .limit(1);

    if (record) {
      return record;
    }
  }

  const [record] = await database
    .select()
    .from(forgeDeployments)
    .where(
      and(
        eq(forgeDeployments.repoId, repoId),
        eq(forgeDeployments.environment, environment),
        eq(forgeDeployments.status, "healthy")
      )
    )
    .orderBy(desc(forgeDeployments.createdAt))
    .limit(1);

  return record ?? null;
}

const controlPlaneRollbackFunnelStageOrder = [
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

type ControlPlaneFunnelStage = (typeof controlPlaneRollbackFunnelStageOrder)[number];

function shouldAdvanceIssueFunnelStageForControlPlaneRollback({
  current,
  next,
  deployment,
}: {
  current: string;
  next: string;
  deployment: {
    environment: z.infer<typeof _canonicalDeploymentEnvironmentSchema>;
    status: DeploymentStatus;
  };
}): boolean {
  if (current === next) {
    return false;
  }

  const currentIndex = controlPlaneRollbackFunnelStageOrder.indexOf(current as ControlPlaneFunnelStage);
  const nextIndex = controlPlaneRollbackFunnelStageOrder.indexOf(next as ControlPlaneFunnelStage);

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

function deriveIssueFunnelStageFromDeployment(
  environment: z.infer<typeof _canonicalDeploymentEnvironmentSchema>,
  status: DeploymentStatus
): ControlPlaneFunnelStage | null {
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

export async function resolveIssueIdsForRollbackDeployment({
  buildId,
  revision,
  issueIds,
  issueIdentifiers,
  commitIds,
  imageTag,
  imageDigest,
  db: database,
}: {
  db: Database;
  buildId?: string;
  revision?: string;
  issueIds?: string[];
  issueIdentifiers?: string[];
  commitIds?: string[];
  imageTag?: string;
  imageDigest?: string;
}) {
  const issueIdsSet = new Set<string>();

  for (const resolvedIssueId of normalizeOptionalUuidArray(issueIds)) {
    issueIdsSet.add(resolvedIssueId);
  }

  const normalizedIssueIdentifiers = normalizeOptionalStringArray(issueIdentifiers);
  if (normalizedIssueIdentifiers.length > 0) {
    const rows = await database
      .select({ id: issues.id })
      .from(issues)
      .where(inArray(issues.identifier, normalizedIssueIdentifiers));

    for (const row of rows) {
      issueIdsSet.add(row.id);
    }
  }

  const commitRefs = normalizeOptionalStringArray([
    ...normalizeOptionalStringArray(commitIds),
    revision,
    imageTag,
    imageDigest,
  ]);
  if (commitRefs.length > 0) {
    const linkedRows = await database
      .select({ issueId: issueGitLinks.issueId })
      .from(issueGitLinks)
      .where(
        and(
          eq(issueGitLinks.type, "commit"),
          inArray(issueGitLinks.externalId, commitRefs)
        )
      );

    for (const row of linkedRows) {
      issueIdsSet.add(row.issueId);
    }
  }

  if (!buildId) {
    return [...issueIdsSet];
  }

  const [build] = await database
    .select({ taskId: forgeBuilds.taskId })
    .from(forgeBuilds)
    .where(eq(forgeBuilds.id, buildId))
    .limit(1);

  if (build?.taskId) {
    issueIdsSet.add(build.taskId);
  }

  return [...issueIdsSet];
}

export async function syncIssueFunnelStageFromDeployment(
  deployment: {
    id: string;
    buildId: string;
    revId: string;
    environment: z.infer<typeof _canonicalDeploymentEnvironmentSchema>;
    status: DeploymentStatus;
  },
  providedIssueIds: string[] = [],
  database: Database = getWebhookDb()
) {
  const nextFunnelStage = deriveIssueFunnelStageFromDeployment(
    deployment.environment,
    deployment.status
  );
  if (!nextFunnelStage) {
    return;
  }

  const issueIds = (providedIssueIds.length > 0)
    ? providedIssueIds
    : await resolveIssueIdsForRollbackDeployment({
      db: database,
      buildId: deployment.buildId,
      revision: deployment.revId,
    });

  if (issueIds.length === 0) return;

  const issuesToSync = await database
    .select()
    .from(issues)
    .where(inArray(issues.id, issueIds));

  for (const issue of issuesToSync) {
    if (!shouldAdvanceIssueFunnelStageForControlPlaneRollback({
      current: issue.funnelStage,
      next: nextFunnelStage,
      deployment: {
        environment: deployment.environment,
        status: deployment.status,
      },
    })) {
      continue;
    }

    const [updatedIssue] = await database
      .update(issues)
      .set({
        funnelStage: nextFunnelStage,
        updatedAt: new Date(),
      })
      .where(eq(issues.id, issue.id))
      .returning();

    if (!updatedIssue) {
      continue;
    }

    await database.insert(activities).values({
      issueId: issue.id,
      type: "funnel_stage_changed",
      fromValue: issue.funnelStage,
      toValue: nextFunnelStage,
      changes: {
        field: "funnelStage",
        from: issue.funnelStage,
        to: nextFunnelStage,
        reason: "rollback_or_status_update",
        deploymentId: deployment.id,
      },
    });

    const [project] = await database
      .select({ workspaceId: projects.workspaceId })
      .from(projects)
      .where(eq(projects.id, issue.projectId))
      .limit(1);

    if (!project) {
      continue;
    }

    await dispatchWebhook(
      database,
      project.workspaceId,
      issue.projectId,
      "issue.funnel_stage_changed",
      buildIssuePayload(updatedIssue),
      {
        field: "funnelStage",
        from: issue.funnelStage,
        to: nextFunnelStage,
      }
    ).catch(() => {});
  }
}

async function logWebhookDelivery({
  requestId,
  event,
  payload,
  statusCode,
  success,
  responseBody,
}: {
  requestId: string;
  event: string;
  payload: unknown;
  statusCode: number;
  success: boolean;
  responseBody: string;
}) {
  const database = getWebhookDb();
  await database.insert(webhookDeliveries).values({
    id: requestId,
    webhookId: null,
    event,
    payload,
    responseBody,
    statusCode,
    success,
  response: null,
  });
}

async function safeLogWebhookDelivery(input: Parameters<typeof logWebhookDelivery>[0]) {
  try {
    await logWebhookDelivery(input);
  } catch {
    // Intentionally ignore webhook logging failures to keep control-plane processing resilient.
  }
}

export async function POST(request: NextRequest) {
  const expectedToken = getActiveWebhookToken();
  const token = getRequestToken(request);

  if (!expectedToken || token !== expectedToken) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();
  const payloadText = await request.text();
  let parsedPayload: unknown;

  try {
    parsedPayload = JSON.parse(payloadText);
  } catch {
    const response = buildResponseBody("Invalid JSON payload", { raw: payloadText });
    await safeLogWebhookDelivery({
      requestId,
      event: "control_plane_rollback",
      payload: payloadText,
      statusCode: 400,
      success: false,
      responseBody: response,
    });
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = controlPlaneWebhookSchema.safeParse(parsedPayload);
  if (!parsed.success) {
    const parsedErrorDetails = normalizeSafeParseError(parsed.error);
    const response = buildResponseBody("Invalid payload", parsedErrorDetails.fieldErrors);
    await safeLogWebhookDelivery({
      requestId,
      event: "control_plane_rollback",
      payload: parsedPayload,
      statusCode: 400,
      success: false,
      responseBody: response,
    });
    return NextResponse.json(
      { error: "Invalid payload", details: parsedErrorDetails },
      { status: 400 }
    );
  }

  const event = parsed.data as ControlPlaneWebhookEvent & {
    rollbackDeploymentId?: string;
    sourceDeploymentId?: string;
    sourceRevision?: string;
    rollbackImageTag?: string;
    metadata?: Record<string, unknown>;
  };
  const environment = normalizeDeploymentEnvironment(event.environment);
  const dedupeKey = dedupeControlPlaneRollback({
    repoId: event.repoId,
    repoName: event.repoName,
    environment: event.environment,
    workspaceId: event.workspaceId,
    sourceDeploymentId: event.sourceDeploymentId,
    sourceRevision: event.sourceRevision,
    rollbackDeploymentId: event.rollbackDeploymentId,
    rollbackImageTag: event.rollbackImageTag,
  });

  if (dedupeKey && hasRecentControlPlaneRollback(dedupeKey)) {
    const dedupedResponse = {
      status: "deduped",
      action: "deduped",
      environment,
      reason: "Duplicate rollback request deduplicated",
    } as const;

    const responseBody = buildResponseBody(
      "Duplicate control-plane rollback request ignored",
      dedupedResponse
    );
    await safeLogWebhookDelivery({
      requestId,
      event: "control_plane_rollback",
      payload: parsedPayload,
      statusCode: 200,
      success: true,
      responseBody,
    });
    return NextResponse.json(dedupedResponse, { status: 200 });
  }

  const repoId = await resolveRepositoryId(event);
  if (!repoId) {
    const response = buildResponseBody("Unable to resolve repository", {
      repoId: event.repoId,
      repoName: event.repoName,
    });
    await safeLogWebhookDelivery({
      requestId,
      event: "control_plane_rollback",
      payload: parsedPayload,
      statusCode: 404,
      success: false,
      responseBody: response,
    });
    return NextResponse.json({ error: "Unable to resolve repository" }, { status: 404 });
  }

  const sourceDeployment = await resolveSourceDeployment(repoId, environment, event);
  const targetDeployment = await resolveRollbackTargetDeployment(repoId, environment, event);
  const resolvedIssueIds = await resolveIssueIdsForRollbackDeployment({
    db: getWebhookDb(),
    buildId: sourceDeployment?.buildId,
    revision: sourceDeployment?.revId,
    issueIds: event.issueIds,
    issueIdentifiers: event.issueIdentifiers,
    commitIds: event.commitIds,
    imageTag: event.sourceRevision,
  });

  if (!targetDeployment) {
    const response = buildResponseBody("Unable to resolve rollback target deployment", {
      repoId,
      environment,
      rollbackDeploymentId: event.rollbackDeploymentId,
      rollbackImageTag: event.rollbackImageTag,
    });
    await safeLogWebhookDelivery({
      requestId,
      event: "control_plane_rollback",
      payload: parsedPayload,
      statusCode: 404,
      success: false,
      responseBody: response,
    });
    return NextResponse.json({ error: "Unable to resolve rollback target deployment" }, { status: 404 });
  }

  if (!sourceDeployment) {
    const response = buildResponseBody("Unable to resolve source deployment", {
      repoId,
      environment,
      sourceDeploymentId: event.sourceDeploymentId,
      sourceRevision: event.sourceRevision,
    });
    await safeLogWebhookDelivery({
      requestId,
      event: "control_plane_rollback",
      payload: parsedPayload,
      statusCode: 404,
      success: false,
      responseBody: response,
    });
    return NextResponse.json({ error: "Unable to resolve source deployment" }, { status: 404 });
  }

  if (
    sourceDeployment.id === targetDeployment.id &&
    sourceDeployment.status === "rolled_back"
  ) {
    const response = buildResponseBody("No-op: source deployment already rolled back", {
      sourceDeploymentId: sourceDeployment.id,
    });
    await safeLogWebhookDelivery({
      requestId,
      event: "control_plane_rollback",
      payload: parsedPayload,
      statusCode: 200,
      success: true,
      responseBody: response,
    });
    return NextResponse.json(
      {
        status: "no-op",
        repoId,
        environment,
        sourceDeploymentId: sourceDeployment.id,
        rollbackDeploymentId: targetDeployment.id,
        resolvedIssueIds,
      },
      { status: 200 }
    );
  }

  const shouldMarkRolledBack = sourceDeployment.status !== "rolled_back";
  const database = getWebhookDb();
  const [updatedSource] = await database
    .update(forgeDeployments)
    .set({
      status: "rolled_back",
      rollbackTargetDeploymentId: targetDeployment.id,
      updatedAt: new Date(),
      deployedAt: shouldMarkRolledBack ? new Date() : sourceDeployment.deployedAt ?? new Date(),
    })
    .where(eq(forgeDeployments.id, sourceDeployment.id))
    .returning();

  if (updatedSource) {
    await syncIssueFunnelStageFromDeployment({
      id: updatedSource.id,
      buildId: updatedSource.buildId,
      revId: updatedSource.revId,
      environment: environment,
      status: "rolled_back",
    }, resolvedIssueIds);
  }

  const finalSourceDeployment = updatedSource ?? sourceDeployment;

  const responsePayload = {
    repoId,
    environment,
    sourceDeploymentId: sourceDeployment.id,
    sourceDeploymentPreviousStatus: sourceDeployment.status,
    sourceDeploymentStatus: finalSourceDeployment.status ?? "rolled_back",
    rollbackDeploymentId: targetDeployment.id,
    rollbackImageTag: targetDeployment.revId,
    reason: event.reason,
    metadata: event.metadata,
    resolvedIssueIds,
  };
  const responseBody = buildResponseBody("Rollback notification processed", responsePayload);
    await safeLogWebhookDelivery({
    requestId,
    event: "control_plane_rollback",
    payload: parsedPayload,
    statusCode: 200,
    success: true,
    responseBody,
  });

  return NextResponse.json(
    {
      status: "applied",
      ...responsePayload,
      action: "mark_rolled_back",
    },
    { status: 200 }
  );
}

export async function GET() {
  return NextResponse.json({ status: "ok", source: "control-plane-webhook" });
}
