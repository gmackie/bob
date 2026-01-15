import { and, eq, isNull, sql } from "@bob/db";
import { db } from "@bob/db/client";
import {
  chatConversations,
  gitCommits,
  pullRequests,
  sessionEvents,
  webhookDeliveries,
} from "@bob/db/schema";

export type WebhookProvider = "github" | "gitlab" | "gitea" | "kanbanger";

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

interface KanbangerCommentPayload {
  event: "comment.created";
  issueId: string;
  comment: {
    id: string;
    body: string;
    user: {
      id: string;
      name: string;
      email?: string;
    };
    createdAt: string;
  };
}

export async function processKanbangerWebhook(
  eventType: string,
  payload: Record<string, unknown>,
  deliveryId: string,
): Promise<void> {
  try {
    if (eventType === "comment.created") {
      await handleKanbangerComment(
        payload as unknown as KanbangerCommentPayload,
      );
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

async function handleKanbangerComment(
  payload: KanbangerCommentPayload,
): Promise<void> {
  const result = await db.execute(sql`
    SELECT id, user_id, next_seq, awaiting_input_question, awaiting_input_options
    FROM chat_conversations
    WHERE kanbanger_task_id = ${payload.issueId}
      AND workflow_status = 'awaiting_input'
      AND awaiting_input_resolved_at IS NULL
    LIMIT 1
  `);

  if (result.rows.length === 0) {
    return;
  }

  const session = result.rows[0] as {
    id: string;
    user_id: string;
    next_seq: number;
    awaiting_input_question: string | null;
    awaiting_input_options: string[] | null;
  };

  const responseValue = payload.comment.body.trim();
  const resolutionJson = JSON.stringify({
    type: "human",
    value: responseValue,
    commentId: payload.comment.id,
    userId: payload.comment.user.id,
    userName: payload.comment.user.name,
  });

  await db.execute(sql`
    UPDATE chat_conversations
    SET workflow_status = 'working',
        status_message = ${"Human response: " + responseValue.slice(0, 100)},
        awaiting_input_resolved_at = NOW(),
        awaiting_input_resolution = ${resolutionJson}::jsonb
    WHERE id = ${session.id}
  `);

  await db
    .update(chatConversations)
    .set({ nextSeq: session.next_seq + 1 })
    .where(eq(chatConversations.id, session.id));

  await db.insert(sessionEvents).values({
    sessionId: session.id,
    seq: session.next_seq,
    direction: "system",
    eventType: "state",
    payload: {
      type: "workflow_status",
      workflowStatus: "working",
      message: `Human response: ${responseValue.slice(0, 100)}`,
      resolution: {
        type: "human",
        value: responseValue,
        source: "kanbanger_comment",
        commentId: payload.comment.id,
      },
    },
  });
}
