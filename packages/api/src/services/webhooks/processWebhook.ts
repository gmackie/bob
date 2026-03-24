import { and, eq, isNull, sql } from "@bob/db";
import { db } from "@bob/db/client";
import {
  activities,
  chatConversations,
  chatMessages,
  forgeBuilds,
  forgeDeployments,
  forgeRevisions,
  gitCommits,
  pullRequests,
  repositories,
  sessionEvents,
  taskRuns,
  webhookDeliveries,
} from "@bob/db/schema";

export type WebhookProvider = "github" | "gitlab" | "gitea" | "planning";

export interface WebhookDeliveryInput {
  provider: WebhookProvider;
  deliveryId: string | null;
  eventType: string;
  action: string | null;
  signatureValid: boolean;
  headers: Record<string, string>;
  payload: Record<string, unknown>;
}

export async function recordWebhookDelivery(
  input: WebhookDeliveryInput,
): Promise<string | null> {
  if (input.deliveryId) {
    const existing = await db.query.webhookDeliveries.findFirst({
      where: and(
        eq(webhookDeliveries.provider, input.provider),
        eq(webhookDeliveries.deliveryId, input.deliveryId),
      ),
    });

    if (existing) {
      return null;
    }
  }

  const [delivery] = await db
    .insert(webhookDeliveries)
    .values({
      provider: input.provider,
      deliveryId: input.deliveryId,
      eventType: input.eventType,
      action: input.action,
      signatureValid: input.signatureValid,
      headers: input.headers,
      payload: input.payload,
      status: "pending",
    })
    .returning({ id: webhookDeliveries.id });

  return delivery?.id ?? null;
}

export async function markDeliveryProcessed(deliveryId: string): Promise<void> {
  await db
    .update(webhookDeliveries)
    .set({ status: "processed", processedAt: new Date() })
    .where(eq(webhookDeliveries.id, deliveryId));
}

export async function markDeliveryFailed(
  deliveryId: string,
  errorMessage: string,
): Promise<void> {
  await db
    .update(webhookDeliveries)
    .set({
      status: "failed",
      errorMessage,
      retryCount: 1,
    })
    .where(eq(webhookDeliveries.id, deliveryId));
}

interface GitHubPRPayload {
  action: string;
  number: number;
  pull_request: {
    id: number;
    number: number;
    state: string;
    draft: boolean;
    title: string;
    body: string | null;
    head: { ref: string };
    base: { ref: string; repo: { owner: { login: string }; name: string } };
    html_url: string;
    additions?: number;
    deletions?: number;
    changed_files?: number;
    created_at: string;
    updated_at: string;
    merged_at: string | null;
    closed_at: string | null;
  };
  repository: {
    owner: { login: string };
    name: string;
  };
}

interface GitHubPushPayload {
  ref: string;
  commits: Array<{
    id: string;
    message: string;
    author: { name: string; email: string };
    timestamp: string;
    url: string;
  }>;
  repository: {
    owner: { login: string };
    name: string;
  };
}

export async function processGitHubWebhook(
  eventType: string,
  payload: Record<string, unknown>,
  deliveryId: string,
): Promise<void> {
  try {
    switch (eventType) {
      case "pull_request":
        await handleGitHubPullRequest(payload as unknown as GitHubPRPayload);
        break;
      case "push":
        await handleGitHubPush(payload as unknown as GitHubPushPayload);
        break;
      case "check_run":
        await handleGitHubCheckRun(payload);
        break;
      case "workflow_run":
        await handleGitHubWorkflowRun(payload);
        break;
      default:
        break;
    }
    await markDeliveryProcessed(deliveryId);
  } catch (error) {
    await markDeliveryFailed(
      deliveryId,
      error instanceof Error ? error.message : "Unknown error",
    );
    throw error;
  }
}

async function handleGitHubPullRequest(
  payload: GitHubPRPayload,
): Promise<void> {
  const pr = payload.pull_request;
  const owner = payload.repository.owner.login;
  const repo = payload.repository.name;

  let status: "draft" | "open" | "merged" | "closed" = "open";
  if (pr.merged_at) {
    status = "merged";
  } else if (pr.state === "closed") {
    status = "closed";
  } else if (pr.draft) {
    status = "draft";
  }

  const existing = await db.query.pullRequests.findFirst({
    where: and(
      eq(pullRequests.provider, "github"),
      isNull(pullRequests.instanceUrl),
      eq(pullRequests.remoteOwner, owner),
      eq(pullRequests.remoteName, repo),
      eq(pullRequests.number, pr.number),
    ),
  });

  if (existing) {
    await db
      .update(pullRequests)
      .set({
        title: pr.title,
        body: pr.body,
        status,
        additions: pr.additions,
        deletions: pr.deletions,
        changedFiles: pr.changed_files,
        mergedAt: pr.merged_at ? new Date(pr.merged_at) : null,
        closedAt: pr.closed_at ? new Date(pr.closed_at) : null,
      })
      .where(eq(pullRequests.id, existing.id));
  }
}

async function handleGitHubPush(payload: GitHubPushPayload): Promise<void> {
  const owner = payload.repository.owner.login;
  const repo = payload.repository.name;

  for (const commit of payload.commits) {
    const existing = await db.query.gitCommits.findFirst({
      where: and(
        eq(gitCommits.provider, "github"),
        isNull(gitCommits.instanceUrl),
        eq(gitCommits.remoteOwner, owner),
        eq(gitCommits.remoteName, repo),
        eq(gitCommits.sha, commit.id),
      ),
    });

    if (!existing) {
      await db.insert(gitCommits).values({
        provider: "github",
        instanceUrl: null,
        remoteOwner: owner,
        remoteName: repo,
        sha: commit.id,
        message: commit.message,
        authorName: commit.author.name,
        authorEmail: commit.author.email,
        committedAt: new Date(commit.timestamp),
        isBobCommit: false,
      });
    }
  }
}

export async function processGitLabWebhook(
  eventType: string,
  payload: Record<string, unknown>,
  deliveryId: string,
  instanceUrl?: string,
): Promise<void> {
  try {
    switch (eventType) {
      case "Merge Request Hook":
        await handleGitLabMergeRequest(payload, instanceUrl ?? null);
        break;
      case "Push Hook":
        await handleGitLabPush(payload, instanceUrl ?? null);
        break;
      default:
        break;
    }
    await markDeliveryProcessed(deliveryId);
  } catch (error) {
    await markDeliveryFailed(
      deliveryId,
      error instanceof Error ? error.message : "Unknown error",
    );
    throw error;
  }
}

async function handleGitLabMergeRequest(
  payload: Record<string, unknown>,
  instanceUrl: string | null,
): Promise<void> {
  const attrs = payload.object_attributes as {
    iid: number;
    title: string;
    description: string | null;
    state: string;
    source_branch: string;
    target_branch: string;
    url: string;
    created_at: string;
    updated_at: string;
    merged_at: string | null;
  };
  const project = payload.project as {
    namespace: string;
    name: string;
  };

  let status: "draft" | "open" | "merged" | "closed" = "open";
  if (attrs.state === "merged") {
    status = "merged";
  } else if (attrs.state === "closed") {
    status = "closed";
  }

  const existing = await db.query.pullRequests.findFirst({
    where: and(
      eq(pullRequests.provider, "gitlab"),
      instanceUrl
        ? eq(pullRequests.instanceUrl, instanceUrl)
        : isNull(pullRequests.instanceUrl),
      eq(pullRequests.remoteOwner, project.namespace),
      eq(pullRequests.remoteName, project.name),
      eq(pullRequests.number, attrs.iid),
    ),
  });

  if (existing) {
    await db
      .update(pullRequests)
      .set({
        title: attrs.title,
        body: attrs.description,
        status,
        mergedAt: attrs.merged_at ? new Date(attrs.merged_at) : null,
      })
      .where(eq(pullRequests.id, existing.id));
  }
}

async function handleGitLabPush(
  payload: Record<string, unknown>,
  instanceUrl: string | null,
): Promise<void> {
  const commits = payload.commits as Array<{
    id: string;
    message: string;
    author: { name: string; email: string };
    timestamp: string;
    url: string;
  }>;
  const project = payload.project as {
    namespace: string;
    name: string;
  };

  for (const commit of commits) {
    const existing = await db.query.gitCommits.findFirst({
      where: and(
        eq(gitCommits.provider, "gitlab"),
        instanceUrl
          ? eq(gitCommits.instanceUrl, instanceUrl)
          : isNull(gitCommits.instanceUrl),
        eq(gitCommits.remoteOwner, project.namespace),
        eq(gitCommits.remoteName, project.name),
        eq(gitCommits.sha, commit.id),
      ),
    });

    if (!existing) {
      await db.insert(gitCommits).values({
        provider: "gitlab",
        instanceUrl,
        remoteOwner: project.namespace,
        remoteName: project.name,
        sha: commit.id,
        message: commit.message,
        authorName: commit.author.name,
        authorEmail: commit.author.email,
        committedAt: new Date(commit.timestamp),
        isBobCommit: false,
      });
    }
  }
}

export async function processGiteaWebhook(
  eventType: string,
  payload: Record<string, unknown>,
  deliveryId: string,
  instanceUrl: string,
): Promise<void> {
  try {
    switch (eventType) {
      case "pull_request":
        await handleGiteaPullRequest(payload, instanceUrl);
        break;
      case "push":
        await handleGiteaPush(payload, instanceUrl);
        break;
      default:
        break;
    }
    await markDeliveryProcessed(deliveryId);
  } catch (error) {
    await markDeliveryFailed(
      deliveryId,
      error instanceof Error ? error.message : "Unknown error",
    );
    throw error;
  }
}

async function handleGiteaPullRequest(
  payload: Record<string, unknown>,
  instanceUrl: string,
): Promise<void> {
  const pr = payload.pull_request as {
    number: number;
    title: string;
    body: string;
    state: string;
    merged: boolean;
    head: { ref: string };
    base: { ref: string };
    created_at: string;
    updated_at: string;
    merged_at: string | null;
    closed_at: string | null;
  };
  const repository = payload.repository as {
    owner: { login: string };
    name: string;
  };

  let status: "draft" | "open" | "merged" | "closed" = "open";
  if (pr.merged) {
    status = "merged";
  } else if (pr.state === "closed") {
    status = "closed";
  }

  const existing = await db.query.pullRequests.findFirst({
    where: and(
      eq(pullRequests.provider, "gitea"),
      eq(pullRequests.instanceUrl, instanceUrl),
      eq(pullRequests.remoteOwner, repository.owner.login),
      eq(pullRequests.remoteName, repository.name),
      eq(pullRequests.number, pr.number),
    ),
  });

  if (existing) {
    await db
      .update(pullRequests)
      .set({
        title: pr.title,
        body: pr.body,
        status,
        mergedAt: pr.merged_at ? new Date(pr.merged_at) : null,
        closedAt: pr.closed_at ? new Date(pr.closed_at) : null,
      })
      .where(eq(pullRequests.id, existing.id));
  }
}

async function handleGiteaPush(
  payload: Record<string, unknown>,
  instanceUrl: string,
): Promise<void> {
  const commits = payload.commits as Array<{
    id: string;
    message: string;
    author: { name: string; email: string };
    timestamp: string;
    url: string;
  }>;
  const repository = payload.repository as {
    owner: { login: string };
    name: string;
  };

  for (const commit of commits) {
    const existing = await db.query.gitCommits.findFirst({
      where: and(
        eq(gitCommits.provider, "gitea"),
        eq(gitCommits.instanceUrl, instanceUrl),
        eq(gitCommits.remoteOwner, repository.owner.login),
        eq(gitCommits.remoteName, repository.name),
        eq(gitCommits.sha, commit.id),
      ),
    });

    if (!existing) {
      await db.insert(gitCommits).values({
        provider: "gitea",
        instanceUrl,
        remoteOwner: repository.owner.login,
        remoteName: repository.name,
        sha: commit.id,
        message: commit.message,
        authorName: commit.author.name,
        authorEmail: commit.author.email,
        committedAt: new Date(commit.timestamp),
        isBobCommit: false,
      });
    }
  }
}

interface PlanningCommentPayload {
  event?: "comment.created";
  issueId?: string;
  issue?: {
    id: string;
    identifier?: string;
    status?: string;
  };
  comment: {
    id: string;
    body: string;
    parentId?: string | null;
    user: {
      id: string;
      name: string;
      email?: string;
    };
    createdAt: string;
  };
  bobRouting?: {
    shouldRoute: boolean;
    reason: "prompt_reply" | "mention";
    issueManaged: boolean;
    promptCommentId: string | null;
    taskRunId: string | null;
    sessionId: string | null;
  } | null;
}

interface NormalizedPlanningCommentPayload {
  issueId: string;
  issueIdentifier: string | null;
  issueStatus: string | null;
  comment: PlanningCommentPayload["comment"];
  bobRouting: NonNullable<PlanningCommentPayload["bobRouting"]> | null;
}

const GATEWAY_URL = process.env.GATEWAY_URL ?? "http://localhost:3002";

function truncateStatusMessage(value: string): string {
  return value.slice(0, 100);
}

function buildExternalCommentMessage(
  payload: NormalizedPlanningCommentPayload,
): string {
  const author =
    payload.comment.user.name ||
    payload.comment.user.email ||
    payload.comment.user.id;
  return `Planning comment from ${author}:\n\n${payload.comment.body.trim()}`;
}

function normalizePlanningCommentPayload(
  payload: PlanningCommentPayload,
): NormalizedPlanningCommentPayload | null {
  const issueId = payload.issue?.id ?? payload.issueId ?? null;
  const body = payload.comment?.body?.trim();

  if (!issueId || !payload.comment?.id || !body || !payload.comment.user?.id) {
    return null;
  }

  return {
    issueId,
    issueIdentifier: payload.issue?.identifier ?? null,
    issueStatus: payload.issue?.status ?? null,
    comment: {
      ...payload.comment,
      body,
      parentId: payload.comment.parentId ?? null,
    },
    bobRouting: payload.bobRouting ?? null,
  };
}

async function getLatestIssueSession(issueId: string) {
  const result = await db.execute(sql`
    SELECT c.id, c.user_id, c.next_seq, c.workflow_status, c.awaiting_input_resolved_at
    FROM chat_conversations c
    LEFT JOIN task_runs tr ON tr.session_id = c.id
    WHERE c.kanbanger_task_id = ${issueId}
       OR tr.kanbanger_issue_id = ${issueId}
    ORDER BY c.updated_at DESC NULLS LAST, c.created_at DESC
    LIMIT 1
  `);

  if (result.rows.length === 0) {
    return null;
  }

  return result.rows[0] as {
    id: string;
    user_id: string;
    next_seq: number;
    workflow_status: string;
    awaiting_input_resolved_at: Date | null;
  };
}

async function setNextSeq(sessionId: string, nextSeq: number) {
  await db
    .update(chatConversations)
    .set({ nextSeq })
    .where(eq(chatConversations.id, sessionId));
}

async function addSessionEvent(
  sessionId: string,
  seq: number,
  eventType: string,
  payload: Record<string, unknown>,
) {
  await db.insert(sessionEvents).values({
    sessionId,
    seq,
    direction: "system",
    eventType,
    payload,
  });
}

async function insertExternalUserMessage(
  sessionId: string,
  content: string,
) {
  await db.insert(chatMessages).values({
    conversationId: sessionId,
    role: "user",
    content,
  });
}

async function sendMessageToGateway(
  userId: string,
  sessionId: string,
  message: string,
) {
  const response = await fetch(`${GATEWAY_URL}/session/send`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      userId,
      sessionId,
      message,
    }),
  });

  if (!response.ok) {
    throw new Error(`Gateway error: ${await response.text()}`);
  }
}

async function recordLateCommentReply(
  session: Awaited<ReturnType<typeof getLatestIssueSession>>,
  payload: NormalizedPlanningCommentPayload,
) {
  if (!session) {
    return;
  }

  await addSessionEvent(session.id, session.next_seq, "external_reply", {
    type: "planning_comment_late",
    reason: payload.bobRouting?.reason ?? "mention",
    commentId: payload.comment.id,
    parentId: payload.comment.parentId ?? null,
    issueId: payload.issueId,
    value: payload.comment.body,
    source: "planning_comment",
  });
  await setNextSeq(session.id, session.next_seq + 1);
}

export async function handlePlanningComment(
  rawPayload: PlanningCommentPayload,
): Promise<void> {
  const payload = normalizePlanningCommentPayload(rawPayload);
  if (!payload?.bobRouting?.shouldRoute) {
    return;
  }

  const session = await getLatestIssueSession(payload.issueId);
  if (!session) {
    return;
  }

  const message = buildExternalCommentMessage(payload);

  if (payload.bobRouting.reason === "prompt_reply") {
    const resolutionJson = JSON.stringify({
      type: "human",
      value: payload.comment.body,
      commentId: payload.comment.id,
      parentId: payload.comment.parentId ?? null,
      userId: payload.comment.user.id,
      userName: payload.comment.user.name,
      userEmail: payload.comment.user.email,
    });

    const updateResult = await db.execute(sql`
      UPDATE chat_conversations
      SET workflow_status = 'working',
          status_message = ${"Human response: " + truncateStatusMessage(payload.comment.body)},
          blocked_reason = NULL,
          awaiting_input_resolved_at = NOW(),
          awaiting_input_resolution = ${resolutionJson}::jsonb,
          updated_at = NOW()
      WHERE id = ${session.id}
        AND workflow_status = 'awaiting_input'
        AND awaiting_input_resolved_at IS NULL
      RETURNING id
    `);

    if (updateResult.rows.length === 0) {
      await recordLateCommentReply(session, payload);
      return;
    }

    await insertExternalUserMessage(session.id, message);
    await addSessionEvent(session.id, session.next_seq, "state", {
      type: "workflow_status",
      workflowStatus: "working",
      message: `Human response: ${truncateStatusMessage(payload.comment.body)}`,
      resolution: {
        type: "human",
        value: payload.comment.body,
        source: "planning_comment",
        commentId: payload.comment.id,
        parentId: payload.comment.parentId ?? null,
      },
    });
    await setNextSeq(session.id, session.next_seq + 1);
    await sendMessageToGateway(session.user_id, session.id, message);
    return;
  }

  if (
    payload.bobRouting.reason === "mention" &&
    ["awaiting_review", "blocked", "working"].includes(session.workflow_status)
  ) {
    await insertExternalUserMessage(session.id, message);

    if (session.workflow_status !== "working") {
      await db.execute(sql`
        UPDATE chat_conversations
        SET workflow_status = 'working',
            status_message = ${"External feedback received"},
            blocked_reason = NULL,
            updated_at = NOW()
        WHERE id = ${session.id}
      `);

      if (session.workflow_status === "blocked") {
        await db
          .update(taskRuns)
          .set({
            status: "running",
            blockedReason: null,
          })
          .where(
            and(
              eq(taskRuns.sessionId, session.id),
              eq(taskRuns.status, "blocked"),
            ),
          );
      }

      await addSessionEvent(session.id, session.next_seq, "state", {
        type: "workflow_status",
        workflowStatus: "working",
        message: "External feedback received",
        source: "planning_comment",
        commentId: payload.comment.id,
      });
    } else {
      await addSessionEvent(session.id, session.next_seq, "external_reply", {
        type: "planning_comment",
        source: "planning_comment",
        commentId: payload.comment.id,
        parentId: payload.comment.parentId ?? null,
        value: payload.comment.body,
      });
    }

    await setNextSeq(session.id, session.next_seq + 1);
    await sendMessageToGateway(session.user_id, session.id, message);
    return;
  }

  await recordLateCommentReply(session, payload);
}

export async function processPlanningWebhook(
  eventType: string,
  payload: Record<string, unknown>,
  deliveryId: string,
): Promise<void> {
  try {
    if (eventType === "comment.created") {
      await handlePlanningComment(payload as unknown as PlanningCommentPayload);
    }
    await markDeliveryProcessed(deliveryId);
  } catch (error) {
    await markDeliveryFailed(
      deliveryId,
      error instanceof Error ? error.message : "Unknown error",
    );
    throw error;
  }
}

// ──────────────────────────────────────────────────────────────
// GitHub Actions CI/CD Integration
// ──────────────────────────────────────────────────────────────

/**
 * Handle GitHub check_run events (individual CI checks like lint, test, build).
 * Maps check conclusions to ForgeGraph build status updates.
 */
async function handleGitHubCheckRun(payload: Record<string, unknown>): Promise<void> {
  const action = payload.action as string;
  if (action !== "completed") return; // Only care about completed checks

  const checkRun = payload.check_run as Record<string, unknown> | undefined;
  if (!checkRun) return;

  const headSha = checkRun.head_sha as string;
  const conclusion = checkRun.conclusion as string; // success, failure, neutral, cancelled, etc.
  const checkName = checkRun.name as string;

  if (!headSha) return;

  // Find the forge revision matching this commit SHA
  const revision = await db.query.forgeRevisions.findFirst({
    where: eq(forgeRevisions.revId, headSha),
  });

  if (!revision) {
    console.log(`[webhook:check_run] No forge revision found for SHA ${headSha}`);
    return;
  }

  // Map check conclusion to build status
  const buildStatus = conclusion === "success" ? "success"
    : conclusion === "failure" ? "failed"
    : conclusion === "cancelled" ? "cancelled"
    : "pending";

  // Find or create a build record
  const idempotencyKey = `check-${headSha}-${checkName}`;
  const [build] = await db
    .insert(forgeBuilds)
    .values({
      revisionId: revision.id,
      repoId: revision.repoId,
      idempotencyKey,
      status: buildStatus,
      ciProvider: "github-actions",
      externalJobId: String(checkRun.id ?? ""),
    })
    .onConflictDoUpdate({
      target: [forgeBuilds.idempotencyKey],
      set: {
        status: buildStatus,
        externalJobId: String(checkRun.id ?? ""),
      },
    })
    .returning();

  // Update gate status on the revision
  if (revision.gates && Array.isArray(revision.gates)) {
    const normalizedName = checkName.toLowerCase();
    const updatedGates = (revision.gates as Array<{ name: string; status: string }>).map(
      (gate) => {
        if (normalizedName.includes(gate.name)) {
          return { ...gate, status: buildStatus };
        }
        return gate;
      },
    );

    // If all gates passed, update revision status
    const allPassed = updatedGates.every((g) => g.status === "success");
    const anyFailed = updatedGates.some((g) => g.status === "failed");

    await db
      .update(forgeRevisions)
      .set({
        gates: updatedGates,
        status: allPassed ? "gates_passed" : anyFailed ? "failed" : "pending",
      })
      .where(eq(forgeRevisions.id, revision.id));
  }

  // Log activity on the linked work item
  if (revision.taskId) {
    await db.insert(activities).values({
      workItemId: revision.taskId,
      type: "build_status_changed",
      toValue: buildStatus,
      metadata: {
        checkName,
        conclusion,
        headSha,
        buildId: build?.id,
        revisionId: revision.id,
      },
    });
  }

  console.log(`[webhook:check_run] Updated build for ${headSha}: ${checkName} → ${buildStatus}`);
}

/**
 * Handle GitHub workflow_run events (entire CI workflow completion).
 * When all checks pass, can trigger deployment creation.
 */
async function handleGitHubWorkflowRun(payload: Record<string, unknown>): Promise<void> {
  const action = payload.action as string;
  if (action !== "completed") return;

  const workflowRun = payload.workflow_run as Record<string, unknown> | undefined;
  if (!workflowRun) return;

  const headSha = workflowRun.head_sha as string;
  const conclusion = workflowRun.conclusion as string;
  const workflowName = workflowRun.name as string;

  if (!headSha) return;

  // Find the forge revision
  const revision = await db.query.forgeRevisions.findFirst({
    where: eq(forgeRevisions.revId, headSha),
  });

  if (!revision) {
    console.log(`[webhook:workflow_run] No forge revision for SHA ${headSha}`);
    return;
  }

  // Create a build record for the overall workflow
  const idempotencyKey = `workflow-${headSha}-${workflowName}`;
  const buildStatus = conclusion === "success" ? "success" : "failed";

  const [build] = await db
    .insert(forgeBuilds)
    .values({
      revisionId: revision.id,
      repoId: revision.repoId,
      idempotencyKey,
      status: buildStatus,
      ciProvider: "github-actions",
      externalJobId: String(workflowRun.id ?? ""),
    })
    .onConflictDoUpdate({
      target: [forgeBuilds.idempotencyKey],
      set: {
        status: buildStatus,
        externalJobId: String(workflowRun.id ?? ""),
      },
    })
    .returning();

  // If workflow succeeded and revision has all gates passed, auto-create staging deployment
  if (conclusion === "success" && build) {
    const existingDeployment = await db.query.forgeDeployments.findFirst({
      where: and(
        eq(forgeDeployments.revisionId, revision.id),
        eq(forgeDeployments.environment, "staging"),
      ),
    });

    if (!existingDeployment) {
      await db.insert(forgeDeployments).values({
        revisionId: revision.id,
        buildId: build.id,
        repoId: revision.repoId,
        environment: "staging",
        status: "deploying",
      });
      console.log(`[webhook:workflow_run] Auto-created staging deployment for ${headSha}`);
    }

    // Update revision status
    await db
      .update(forgeRevisions)
      .set({ status: "gates_passed" })
      .where(eq(forgeRevisions.id, revision.id));
  }

  // Log activity
  if (revision.taskId) {
    await db.insert(activities).values({
      workItemId: revision.taskId,
      type: "build_status_changed",
      toValue: buildStatus,
      metadata: {
        workflowName,
        conclusion,
        headSha,
        buildId: build?.id,
      },
    });
  }

  console.log(`[webhook:workflow_run] ${workflowName} for ${headSha}: ${conclusion}`);
}
