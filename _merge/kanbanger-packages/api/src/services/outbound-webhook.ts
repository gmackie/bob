import { eq, and } from "drizzle-orm";
import {
  outboundWebhooks,
  outboundWebhookDeliveries,
  issues,
  projects,
  workspaces,
  type Database,
} from "@linear-clone/db";
import crypto from "crypto";

export type OutboundWebhookEvent =
  | "issue.created"
  | "issue.updated"
  | "issue.deleted"
  | "issue.status_changed"
  | "issue.completed"
  | "issue.funnel_stage_changed"
  | "comment.created";

export interface WebhookIssuePayload {
  id: string;
  identifier: string;
  title: string;
  description?: string | null;
  status: string;
  priority: string;
  type: string;
  projectId: string;
  assigneeId?: string | null;
  creatorId: string;
  dueDate?: Date | null;
  estimate?: number | null;
  createdAt: Date;
  updatedAt: Date;
  completedAt?: Date | null;
  funnelSourceType: string;
  funnelSourceId?: string | null;
  funnelSourceUrl?: string | null;
  funnelTshirtSize?: string | null;
  funnelArtifactType: string;
  funnelStage: string;
  funnelMetadata?: unknown;
}

export interface WebhookWorkspacePayload {
  id: string;
  name: string;
  slug: string;
}

export interface WebhookProjectPayload {
  id: string;
  name: string;
  key: string;
}

export interface WebhookPayload {
  event: OutboundWebhookEvent;
  timestamp: string;
  workspace: WebhookWorkspacePayload;
  project: WebhookProjectPayload;
  issue: WebhookIssuePayload;
  changes?: {
    field: string;
    from: string | null;
    to: string | null;
  };
  comment?: {
    id: string;
    parentId: string | null;
    body: string;
    createdAt: string;
    user: {
      id: string;
      name: string;
      email: string;
    };
  };
  bobRouting?: {
    shouldRoute: boolean;
    reason: "prompt_reply" | "mention";
    issueManaged: boolean;
    promptCommentId: string | null;
    taskRunId: string | null;
    sessionId: string | null;
  } | null;
  bobIssueUpdate?: {
    changedFields: Array<{
      field:
        | "title"
        | "description"
        | "priority"
        | "assigneeId"
        | "projectId"
        | "parentId"
        | "epicId";
      from: string | null;
      to: string | null;
    }>;
    forceNewRun: boolean;
  } | null;
}

export function generateHmacSha256Hex(payload: string, secret: string): string {
  const hmac = crypto.createHmac("sha256", secret);
  hmac.update(payload);
  return hmac.digest("hex");
}

export function generateSignature(payload: string, secret: string): string {
  return `sha256=${generateHmacSha256Hex(payload, secret)}`;
}

export function verifySignature(
  payload: string,
  signature: string,
  secret: string
): boolean {
  const expected = generateSignature(payload, secret);
  try {
    return crypto.timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(expected)
    );
  } catch {
    return false;
  }
}

const WEBHOOK_TIMEOUT_MS = 30000;

async function deliverWebhook(
  db: Database,
  webhookId: string,
  url: string,
  secret: string | null,
  event: OutboundWebhookEvent,
  payload: WebhookPayload
): Promise<void> {
  const payloadString = JSON.stringify(payload);
  const startTime = Date.now();

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "User-Agent": "LinearClone-Webhook/1.0",
    "X-Webhook-Event": event,
    "X-Webhook-Delivery": crypto.randomUUID(),
    "X-Webhook-Timestamp": payload.timestamp,
  };

  if (secret) {
    headers["X-Webhook-Signature"] = generateSignature(payloadString, secret);
  }

  let statusCode: number | null = null;
  let responseBody: string | null = null;
  let success = false;
  let error: string | null = null;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), WEBHOOK_TIMEOUT_MS);

    const response = await fetch(url, {
      method: "POST",
      headers,
      body: payloadString,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      signal: controller.signal as any,
    });

    clearTimeout(timeoutId);

    statusCode = response.status;
    responseBody = await response.text().catch(() => null);
    success = response.ok;

    if (!response.ok) {
      error = `HTTP ${response.status}: ${response.statusText}`;
    }
  } catch (err) {
    error =
      err instanceof Error ? err.message : "Unknown error during delivery";
  }

  const durationMs = Date.now() - startTime;

  await db.insert(outboundWebhookDeliveries).values({
    webhookId,
    event,
    payload,
    statusCode,
    responseBody,
    success,
    error,
    durationMs,
  });
}

export async function dispatchWebhook(
  db: Database,
  workspaceId: string,
  projectId: string,
  event: OutboundWebhookEvent,
  issue: WebhookIssuePayload,
  changes?: { field: string; from: string | null; to: string | null },
  extras?: Pick<WebhookPayload, "comment" | "bobRouting" | "bobIssueUpdate">
): Promise<void> {
  const webhooks = await db
    .select()
    .from(outboundWebhooks)
    .where(
      and(
        eq(outboundWebhooks.workspaceId, workspaceId),
        eq(outboundWebhooks.enabled, true)
      )
    );

  const matchingWebhooks = webhooks.filter((webhook) => {
    const events = webhook.events as OutboundWebhookEvent[];
    const projectIds = webhook.projectIds as string[] | null;

    const subscribesToEvent = events.includes(event);
    const matchesProject =
      !projectIds || projectIds.length === 0 || projectIds.includes(projectId);

    return subscribesToEvent && matchesProject;
  });

  if (matchingWebhooks.length === 0) {
    return;
  }

  const [workspace] = await db
    .select({
      id: workspaces.id,
      name: workspaces.name,
      slug: workspaces.slug,
    })
    .from(workspaces)
    .where(eq(workspaces.id, workspaceId))
    .limit(1);

  const [project] = await db
    .select({
      id: projects.id,
      name: projects.name,
      key: projects.key,
    })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);

  if (!workspace || !project) {
    console.error("Workspace or project not found for webhook dispatch");
    return;
  }

  const payload: WebhookPayload = {
    event,
    timestamp: new Date().toISOString(),
    workspace,
    project,
    issue,
    changes,
    ...(extras ?? {}),
  };

  for (const webhook of matchingWebhooks) {
    deliverWebhook(
      db,
      webhook.id,
      webhook.url,
      webhook.secret,
      event,
      payload
    ).catch((err) => {
      console.error(`Failed to deliver webhook ${webhook.id}:`, err);
    });
  }
}

export function buildIssuePayload(
  issue: typeof issues.$inferSelect
): WebhookIssuePayload {
  return {
    id: issue.id,
    identifier: issue.identifier,
    title: issue.title,
    description: issue.description,
    status: issue.status,
    priority: issue.priority,
    type: issue.type,
    projectId: issue.projectId,
    assigneeId: issue.assigneeId,
    creatorId: issue.creatorId,
    dueDate: issue.dueDate,
    estimate: issue.estimate,
    funnelSourceType: issue.funnelSourceType,
    funnelSourceId: issue.funnelSourceId,
    funnelSourceUrl: issue.funnelSourceUrl,
    funnelTshirtSize: issue.funnelTshirtSize,
    funnelArtifactType: issue.funnelArtifactType,
    funnelStage: issue.funnelStage,
    funnelMetadata: issue.funnelMetadata,
    createdAt: issue.createdAt,
    updatedAt: issue.updatedAt,
  };
}
