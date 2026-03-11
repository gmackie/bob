import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

const deploymentEnvironmentSchema = z.enum(["dev", "staging", "production", "preview"]);
const _rollbackSeveritySchema = z.enum(["critical", "warning", "info"]);
const _rollbackEnvironmentSchema = z.enum(["production", "staging", "dev", "preview"]);

const _controlPlaneWebhookSchema = z
  .object({
    source: z
      .enum(["control-plane", "alertmanager"])
      .default("alertmanager"),
    repoId: z.string().uuid().optional(),
    repoName: z.string().min(1).optional(),
    workspaceId: z.string().uuid().optional(),
    environment: deploymentEnvironmentSchema.default("production"),
    sourceDeploymentId: z.string().uuid().optional(),
    sourceRevision: z.string().min(1).optional(),
    rollbackDeploymentId: z.string().uuid().optional(),
    rollbackImageTag: z.string().min(1).optional(),
    reason: z.string().max(5000).optional(),
    metadata: z.record(z.unknown()).optional(),
  })
  .superRefine((value, ctx) => {
    if (!value.repoId && !value.repoName) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Either repoId or repoName is required.",
        path: ["repoId"],
      });
    }
  });

const alertWebhookSchema = z.object({
  alerts: z
    .array(
      z.object({
        labels: z.record(z.string()).default({}),
        annotations: z.record(z.string()).default({}),
        fingerprint: z.string().optional(),
        status: z.enum(["firing", "resolved"]).default("firing").optional(),
        startsAt: z.string().optional(),
        endsAt: z.string().optional(),
        generatorURL: z.string().optional(),
      })
    )
    .min(1),
  status: z
    .enum(["firing", "resolved"])
    .default("firing"),
  receiver: z.string().optional(),
  commonLabels: z.record(z.string()).optional(),
  commonAnnotations: z.record(z.string()).optional(),
  groupLabels: z.record(z.string()).optional(),
});

type ControlPlaneWebhookEvent = z.infer<typeof _controlPlaneWebhookSchema>;
type AlertWebhookPayload = z.infer<typeof alertWebhookSchema>;
type AlertmanagerWebhookPayload = AlertWebhookPayload & {
  status?: "firing" | "resolved";
  commonLabels?: Record<string, string>;
  commonAnnotations?: Record<string, string>;
  groupLabels?: Record<string, string>;
};
type AlertmanagerControlPlaneContext = Omit<AlertmanagerWebhookPayload, "alerts">;
type PrometheusAlert = {
  status?: "firing" | "resolved";
  labels: Record<string, string>;
  annotations: Record<string, string>;
  fingerprint?: string;
  startsAt?: string;
  endsAt?: string;
  generatorURL?: string;
};
type RollbackDecision = {
  alertName: string;
  action: "skipped" | "deduped" | "no-target" | "disabled" | "failed" | "triggered";
  reason: string;
  response?: unknown;
};
type RollbackSeverity = z.infer<typeof _rollbackSeveritySchema>;
type RollbackPolicyEnvironment = z.infer<typeof _rollbackEnvironmentSchema>;
type RollbackPolicy = {
  enabled: boolean;
  severities: RollbackSeverity[];
  environments: RollbackPolicyEnvironment[];
  dedupeWindowMs: number;
};

const controlPlaneRollbackDedupe = new Map<string, number>();

export function resolveAlertEnvironment(
  value: string | undefined,
  namespace: string | undefined
): z.infer<typeof deploymentEnvironmentSchema> {
  if (value) {
    const normalized = value.toLowerCase();
    if (normalized === "prod" || normalized === "production") return "production";
    if (normalized === "staging") return "staging";
    if (normalized === "dev" || normalized === "development") return "dev";
    if (normalized === "preview") return "preview";
  }

  if (namespace?.includes("prod")) return "production";
  if (namespace?.includes("staging")) return "staging";
  if (namespace?.includes("dev") || namespace?.includes("development")) return "dev";
  if (namespace?.includes("preview")) return "preview";

  return "staging";
}

function readBooleanEnv(input: string | undefined, defaultValue: boolean): boolean {
  if (input == null || input.trim().length === 0) {
    return defaultValue;
  }

  const normalized = input.trim().toLowerCase();
  return normalized === "true" || normalized === "1" || normalized === "yes" || normalized === "on";
}

function readCommaList(input: string | undefined, fallback: string[]): string[] {
  if (!input) {
    return fallback;
  }

  const values = input
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  return values.length > 0 ? values : fallback;
}

function readIntEnv(input: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(input ?? "", 10);
  if (Number.isNaN(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
}

function getRollbackPolicyConfig(): RollbackPolicy {
  return {
    enabled: readBooleanEnv(
      process.env.FORGEGRAPH_AUTO_ROLLBACK_ENABLED ??
        process.env.PROMETHEUS_AUTO_ROLLBACK_ENABLED,
      false
    ),
    severities: readCommaList(
      process.env.FORGEGRAPH_AUTO_ROLLBACK_SEVERITIES ??
        process.env.PROMETHEUS_AUTO_ROLLBACK_SEVERITIES,
      ["critical"]
    ) as RollbackSeverity[],
    environments: readCommaList(
      process.env.FORGEGRAPH_AUTO_ROLLBACK_ENVIRONMENTS ??
        process.env.PROMETHEUS_AUTO_ROLLBACK_ENVIRONMENTS,
      ["production"]
    ) as RollbackPolicyEnvironment[],
    dedupeWindowMs: readIntEnv(
      process.env.FORGEGRAPH_ROLLBACK_DEDUPE_WINDOW_MS ??
        process.env.PROMETHEUS_ROLLBACK_DEDUPE_WINDOW_MS,
      5 * 60 * 1000
    ),
  };
}

function cleanupDedupes(): void {
  const now = Date.now();
  for (const [key, expiresAt] of controlPlaneRollbackDedupe.entries()) {
    if (expiresAt <= now) {
      controlPlaneRollbackDedupe.delete(key);
    }
  }
}

function hasRecentRollbackDecision(dedupeKey: string): boolean {
  cleanupDedupes();
  const now = Date.now();
  const existing = controlPlaneRollbackDedupe.get(dedupeKey);
  if (existing && existing > now) {
    return true;
  }

  controlPlaneRollbackDedupe.set(dedupeKey, now + getRollbackPolicyConfig().dedupeWindowMs);
  return false;
}

function firstNonEmptyString(...values: Array<string | undefined>) {
  return values.find((value): value is string => typeof value === "string" && value.trim().length > 0);
}

function pickRepoNameFromLabels(labels: Record<string, string>): string | undefined {
  return firstNonEmptyString(
    labels.repository,
    labels.repo,
    labels.project,
    labels.repository_name,
    labels.repositoryName
  );
}

function pickRollbackImageTag(
  labels: Record<string, string>,
  annotations: Record<string, string>
) {
  return firstNonEmptyString(
    annotations.rollback_image_tag,
    annotations.rollbackImage,
    labels.rollback_image_tag,
    labels.rollback_image
  );
}

function normalizeEnvironmentLabel(value: string | undefined): string {
  if (!value) return "";
  const normalized = value.toLowerCase();
  if (normalized.includes("prod")) return "production";
  if (normalized.includes("staging") || normalized.includes("stag")) return "staging";
  if (normalized.includes("dev") || normalized.includes("development")) return "dev";
  if (normalized.includes("preview")) return "preview";
  return normalized;
}

function mapSeverity(value?: string): RollbackSeverity {
  const normalized = (value || "").toLowerCase();
  if (
    normalized === "critical" ||
    normalized === "fatal" ||
    normalized === "emergency"
  ) {
    return "critical";
  }
  if (
    normalized === "warning" ||
    normalized === "warn" ||
    normalized === "high" ||
    normalized === "medium"
  ) {
    return "warning";
  }

  return "info";
}

function getNonEmptyWebhookToken(
  ...tokens: Array<string | undefined>
): string | undefined {
  return tokens.find((token) => typeof token === "string" && token.trim().length > 0);
}

export function mapPrometheusAlertToControlPlanePayload(
  payload: AlertWebhookPayload
): ControlPlaneWebhookEvent {
  const firstAlert = payload.alerts[0];
  if (!firstAlert) {
    throw new Error("Missing alert payload");
  }

  const labels = firstAlert.labels;
  const annotations = firstAlert.annotations;
  const repoName = pickRepoNameFromLabels(labels);

  const environment = resolveAlertEnvironment(labels.environment, labels.namespace);
  const sourceDeploymentId = firstNonEmptyString(
    labels.source_deployment_id,
    labels.sourceDeploymentId,
    labels.rollout_source_deployment_id
  );
  const sourceRevision = firstNonEmptyString(
    labels.source_revision,
    labels.sourceRevision,
    labels.commit,
    labels.sha,
    labels.image_digest,
    labels.imageDigest
  );

  const rollbackImageTag = pickRollbackImageTag(labels, annotations);
  const reason = firstNonEmptyString(
    annotations.reason,
    labels.reason,
    `${payload.receiver ? `receiver=${payload.receiver}` : "alertmanager"}`
  );

  if (!repoName) {
    throw new Error("Missing repository name in alert payload");
  }

  return {
    source: "alertmanager",
    repoName,
    environment,
    sourceDeploymentId,
    sourceRevision,
    rollbackImageTag,
    reason,
    metadata: {
      alertmanager: {
        status: payload.status,
        receiver: payload.receiver,
        alerts: payload.alerts.map((alert) => ({
          fingerprint: alert.fingerprint,
          labels: alert.labels,
          annotations: alert.annotations,
          status: alert.status,
          startsAt: alert.startsAt,
          endsAt: alert.endsAt,
        })),
      },
      },
  } as ControlPlaneWebhookEvent;
}

function createControlPlanePayload(
  alert: PrometheusAlert,
  commonMetadata: {
    namespace?: string;
    environment?: string;
    commonLabels?: Record<string, string>;
  },
): ControlPlaneWebhookEvent | null {
  const repoName = pickRepoNameFromLabels(alert.labels) ??
    firstNonEmptyString(
      commonMetadata.commonLabels?.repository,
      commonMetadata.commonLabels?.repo,
      commonMetadata.commonLabels?.project,
      commonMetadata.commonLabels?.service
    );

  if (!repoName) {
    return null;
  }

  const sourceDeploymentId = firstNonEmptyString(
    alert.labels.source_deployment_id,
    alert.labels.sourceDeploymentId
  );
  const sourceRevision = firstNonEmptyString(
    alert.labels.source_revision,
    alert.labels.sourceRevision,
    alert.labels.revision,
    alert.labels.sha,
    alert.labels.commit
  );
  const rollbackImageTag = firstNonEmptyString(
    alert.annotations.rollback_image_tag,
    alert.annotations.rollback_image,
    alert.labels.rollback_image_tag,
    alert.labels.rollback_image
  );
  const reason =
    alert.annotations.reason ??
    alert.labels.reason ??
    firstNonEmptyString(
      alert.labels.alertname,
      alert.labels.severity,
      `${alert.labels.namespace || "default namespace"}`
    );
  const environment = normalizeEnvironmentLabel(
    firstNonEmptyString(alert.labels.environment, alert.labels.env) ||
      commonMetadata.environment ||
      commonMetadata.namespace
  ) || "production";

  return {
    source: "alertmanager",
    repoName,
    environment: environment as z.infer<typeof deploymentEnvironmentSchema>,
    sourceDeploymentId,
    sourceRevision,
    rollbackImageTag,
    reason,
    metadata: {
      source: "alertmanager",
      alertname: alert.labels.alertname,
      fingerprint: alert.fingerprint,
      severity: alert.labels.severity,
      namespace: alert.labels.namespace,
      pod: alert.labels.pod,
      service: alert.labels.service,
      reasonSource: "prometheus-webhook",
    },
  } as ControlPlaneWebhookEvent;
}

function getExpectedPrometheusToken() {
  return getNonEmptyWebhookToken(
    process.env.FORGEGRAPH_PROMETHEUS_WEBHOOK_TOKEN,
    process.env.PROMETHEUS_WEBHOOK_TOKEN,
    process.env.FORGEGRAPH_CONTROL_PLANE_WEBHOOK_TOKEN,
    process.env.CONTROL_PLANE_WEBHOOK_TOKEN,
    process.env.PROMETHEUS_BEARER_TOKEN
  );
}

function getExpectedControlPlaneToken() {
  return getNonEmptyWebhookToken(
    process.env.FORGEGRAPH_CONTROL_PLANE_WEBHOOK_TOKEN,
    process.env.CONTROL_PLANE_WEBHOOK_TOKEN,
    process.env.PROMETHEUS_WEBHOOK_TOKEN,
    process.env.PROMETHEUS_BEARER_TOKEN
  );
}

function getRequestToken(request: NextRequest) {
  const authorizationHeader = request.headers.get("authorization");
  if (authorizationHeader?.toLowerCase().startsWith("bearer ")) {
    return authorizationHeader.slice("bearer ".length).trim();
  }

  return request.headers.get("x-webhook-token")?.trim();
}

function nowIso8601(): string {
  return new Date().toISOString();
}

async function maybeTriggerControlPlaneRollback(
  alert: PrometheusAlert,
  payload: AlertmanagerControlPlaneContext,
  request: NextRequest
): Promise<RollbackDecision> {
  const policy = getRollbackPolicyConfig();
  const alertName = alert.labels.alertname || "unknown-alert";

  if (!policy.enabled) {
    return {
      alertName,
      action: "disabled",
      reason: "Rollback policy disabled in environment",
    };
  }

  const resolvedSeverity = mapSeverity(alert.labels.severity);
  if (!policy.severities.includes(resolvedSeverity)) {
    return {
      alertName,
      action: "skipped",
      reason: `Severity "${resolvedSeverity}" not in policy allowlist`,
    };
  }

  const namespace =
    alert.labels.namespace ||
    payload.commonLabels?.namespace ||
    payload.groupLabels?.namespace;
  const resolvedEnvironment = normalizeEnvironmentLabel(
    alert.labels.environment ||
      alert.labels.env ||
      namespace ||
      payload.commonLabels?.environment ||
      payload.groupLabels?.environment
  ) || "production";

  if (!policy.environments.includes(resolvedEnvironment as RollbackPolicyEnvironment)) {
    return {
      alertName,
      action: "skipped",
      reason: `Environment "${resolvedEnvironment}" not in rollback policy environments`,
    };
  }

  const controlPlanePayload = createControlPlanePayload(alert, {
    namespace,
    environment: resolvedEnvironment,
    commonLabels: payload.commonLabels,
  });
  if (!controlPlanePayload) {
    return {
      alertName,
      action: "no-target",
      reason: "Missing repo context for control-plane rollback",
    };
  }

  if (
    !controlPlanePayload.sourceDeploymentId &&
    !controlPlanePayload.sourceRevision &&
    !controlPlanePayload.rollbackImageTag
  ) {
    return {
      alertName,
      action: "no-target",
      reason: "Missing sourceRevision or rollbackImageTag in alert payload",
    };
  }

  const dedupeSeed = [
    controlPlanePayload.repoName,
    controlPlanePayload.environment,
    controlPlanePayload.sourceRevision,
    controlPlanePayload.rollbackImageTag,
    alert.fingerprint || alertName,
  ]
    .filter(Boolean)
    .join("|");

  if (hasRecentRollbackDecision(dedupeSeed)) {
    return {
      alertName,
      action: "deduped",
      reason: "Rollback event deduplicated within configured window",
    };
  }

  const controlPlaneToken = getExpectedControlPlaneToken();
  if (!controlPlaneToken) {
    return {
      alertName,
      action: "disabled",
      reason: "ForgeGraph control-plane callback not configured in this environment",
    };
  }

  const controlPlaneUrl = new URL("/api/webhooks/control-plane", request.url);
  const requestId = crypto.randomUUID();

  let response: Response;
  try {
    response = await fetch(controlPlaneUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${controlPlaneToken}`,
        "x-request-id": requestId,
      },
      body: JSON.stringify({
        ...controlPlanePayload,
        metadata: {
          ...controlPlanePayload.metadata,
          controlPlaneRequestAt: nowIso8601(),
          controlPlaneRequestId: requestId,
          sourceAlertStatus: alert.status ?? payload.status,
        },
      }),
    });
  } catch (error: unknown) {
    return {
      alertName,
      action: "failed",
      reason: error instanceof Error ? error.message : "Failed to trigger control-plane rollback",
    };
  }

  const controlPlaneResponseText = await response.text();
  let controlPlaneResponse: unknown = controlPlaneResponseText;
  try {
    controlPlaneResponse = JSON.parse(controlPlaneResponseText);
  } catch {
    controlPlaneResponse = controlPlaneResponseText;
  }

  if (!response.ok) {
    return {
      alertName,
      action: "failed",
      reason: `Control-plane rollback request failed with HTTP ${response.status}`,
      response: {
        requestId,
        statusCode: response.status,
        body: controlPlaneResponse,
      },
    };
  }

  return {
    alertName,
    action: "triggered",
    reason: "Rollback request submitted to ForgeGraph",
    response: {
      requestId,
      statusCode: response.status,
      body: controlPlaneResponse,
      repoName: controlPlanePayload.repoName,
      environment: controlPlanePayload.environment,
    },
  };
}

export async function POST(request: NextRequest) {
  const expectedToken = getExpectedPrometheusToken();
  const requestToken = getRequestToken(request);

  if (!expectedToken || requestToken !== expectedToken) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rawPayload = await request.text();
  let parsedPayload: unknown;
  try {
    parsedPayload = JSON.parse(rawPayload);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const alertPayload = alertWebhookSchema.safeParse(parsedPayload);
  if (!alertPayload.success) {
    return NextResponse.json(
      { error: "Invalid payload", details: alertPayload.error.flatten() },
      { status: 400 }
    );
  }

  let controlPlaneEvent: ControlPlaneWebhookEvent;
  try {
    controlPlaneEvent = mapPrometheusAlertToControlPlanePayload(alertPayload.data);
  } catch (error: unknown) {
    return NextResponse.json(
      {
        error: "Invalid mapped control-plane payload",
        details:
          error instanceof z.ZodError
            ? error.flatten()
            : "Unable to build rollback payload from alert data",
      },
      { status: 400 }
    );
  }

  const rollbackDecisions: RollbackDecision[] = [];
  for (const alert of alertPayload.data.alerts) {
    const shouldHandle =
      (alertPayload.data.status === "firing" &&
        (!alert.status || alert.status === "firing")) ||
      (alertPayload.data.status === "resolved" && alert.status === "resolved");

    if (!shouldHandle) {
      continue;
    }

    const decision = await maybeTriggerControlPlaneRollback(
      alert,
      {
        status: alertPayload.data.status,
        commonLabels: alertPayload.data.commonLabels,
        commonAnnotations: alertPayload.data.commonAnnotations,
        groupLabels: alertPayload.data.groupLabels,
      },
      request
    );
    rollbackDecisions.push(decision);
  }

  const rollbackFailures = rollbackDecisions.filter((decision) => decision.action === "failed").length;
  const responseStatus = rollbackFailures > 0 ? 502 : 200;
  return NextResponse.json(
    {
      success: true,
      processed: alertPayload.data.alerts.length,
      status: alertPayload.data.status,
      source: "prometheus-alert-webhook",
      controlPlaneRollbacks: rollbackDecisions,
      rollbackPolicyEnabled: getRollbackPolicyConfig().enabled,
      sampleMappedPayload: controlPlaneEvent,
    },
    { status: responseStatus }
  );
}

export async function GET() {
  return NextResponse.json({ status: "ok", source: "prometheus-alert-webhook" });
}
