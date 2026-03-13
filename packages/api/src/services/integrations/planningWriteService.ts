import { and, desc, eq } from "@bob/db";
import { db } from "@bob/db/client";
import { chatConversations, taskRuns } from "@bob/db/schema";

import { createHash } from "node:crypto";
import {
  getPlanningApiKey,
  getPlanningBaseUrl,
} from "./planningRemoteConfig";

export type KanbangerIssueStatus =
  | "todo"
  | "in_progress"
  | "in_review"
  | "done"
  | "blocked";

export type KanbangerMilestoneKind =
  | "progress"
  | "blocked"
  | "review_ready"
  | "verification_result"
  | "completed";

export type KanbangerArtifactType =
  | "pr"
  | "verification"
  | "build"
  | "test_report"
  | "doc"
  | "deliverable"
  | "other";

export type KanbangerArtifactRole =
  | "primary"
  | "review"
  | "verification"
  | "documentation"
  | "deliverable"
  | "build"
  | "test_report"
  | "other";

interface SessionTaskContext {
  sessionId: string;
  issueId: string | null;
  taskRunId: string | null;
  issueIdentifier: string | null;
}

interface SessionScopedInput {
  userId: string;
  sessionId: string;
}

export interface ReportMilestoneInput extends SessionScopedInput {
  kind: KanbangerMilestoneKind;
  message: string;
  phase?: string;
  progress?: string;
  verificationResult?: "passed" | "failed";
}

export interface RequestInputPromptInput extends SessionScopedInput {
  question: string;
  options?: string[];
  defaultAction: string;
  timeoutMinutes: number;
  expiresAt: Date;
}

export interface RecordPromptResolutionInput extends SessionScopedInput {
  resolutionType: "human" | "timeout";
  value: string;
}

export interface SetIssueStatusInput extends SessionScopedInput {
  status: KanbangerIssueStatus;
}

export interface AttachArtifactInput extends SessionScopedInput {
  artifactType: KanbangerArtifactType;
  artifactRole?: KanbangerArtifactRole;
  url: string;
  title?: string;
  summary?: string;
}

export interface MarkRunReviewReadyInput extends SessionScopedInput {
  summary: string;
  prUrl: string;
  notesForReviewer?: string;
}

export interface CompleteTaskRunInput extends SessionScopedInput {
  summary: string;
  prUrl?: string;
  markIssueDone?: boolean;
}

export interface RecordVerificationResultInput extends SessionScopedInput {
  result: "passed" | "failed";
  summary: string;
  artifactUrl?: string;
}

export interface MarkRunCompletedAfterMergeInput extends SessionScopedInput {
  summary: string;
  prUrl?: string;
}

async function getSessionTaskContext(
  userId: string,
  sessionId: string,
): Promise<SessionTaskContext> {
  const session = await db.query.chatConversations.findFirst({
    where: and(
      eq(chatConversations.id, sessionId),
      eq(chatConversations.userId, userId),
    ),
  });

  if (!session) {
    throw new Error("Session not found");
  }

  const taskRun = await db.query.taskRuns.findFirst({
    where: and(
      eq(taskRuns.sessionId, sessionId),
      eq(taskRuns.userId, userId),
    ),
    orderBy: desc(taskRuns.createdAt),
  });

  return {
    sessionId: session.id,
    issueId: session.kanbangerTaskId ?? taskRun?.kanbangerIssueId ?? null,
    taskRunId: taskRun?.id ?? null,
    issueIdentifier: taskRun?.kanbangerIssueIdentifier ?? null,
  };
}

function createIdempotencyKey(parts: Array<string | number | null | undefined>) {
  const payload = parts.map((part) => part ?? "").join("|");
  return createHash("sha256").update(payload).digest("hex");
}

async function kanbangerMutation<T>(
  path: string,
  input: unknown,
  idempotencyKey: string,
): Promise<T | null> {
  const planningApiKey = getPlanningApiKey();

  if (!planningApiKey) {
    console.warn(
      `[KanbangerWriteService] PLANNING_API_KEY not set, skipping ${path}`,
    );
    return null;
  }

  const response = await fetch(`${getPlanningBaseUrl()}/api/trpc/${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-API-Key": planningApiKey,
      "Idempotency-Key": idempotencyKey,
    },
    body: JSON.stringify({ "0": { json: input } }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Planning API error for ${path}: ${text}`);
  }

  const result = (await response.json()) as Array<{
    result?: { data?: { json?: T } };
    error?: { message?: string };
  }>;

  if (result[0]?.error) {
    throw new Error(result[0].error.message ?? `Planning error for ${path}`);
  }

  return result[0]?.result?.data?.json ?? null;
}

async function createIssueComment(
  issueId: string | null,
  body: string,
  idempotencyKey: string,
) {
  if (!issueId) {
    return null;
  }

  return kanbangerMutation<{ id?: string }>(
    "comment.create",
    { issueId, body },
    idempotencyKey,
  );
}

async function syncBobRunProjection(
  context: SessionTaskContext,
  input: {
    workflowStatus?: string;
    runStatus?: "in_progress" | "completed" | "failed";
    latestSummary?: string;
    lastPromptCommentId?: string;
    reviewUrl?: string;
    issueStatus?: Exclude<KanbangerIssueStatus, "blocked">;
  },
  idempotencyKey: string,
) {
  if (!context.issueId || !context.taskRunId) {
    return null;
  }

  return kanbangerMutation(
    "agent.syncBobRun",
    {
      issueId: context.issueId,
      taskRunId: context.taskRunId,
      sessionId: context.sessionId,
      executionBackend: "bob",
      workflowStatus: input.workflowStatus,
      runStatus: input.runStatus,
      latestSummary: input.latestSummary,
      lastPromptCommentId: input.lastPromptCommentId,
      reviewUrl: input.reviewUrl,
      issueStatus: input.issueStatus,
      idempotencyKey,
    },
    idempotencyKey,
  );
}

async function createCanonicalArtifact(
  context: SessionTaskContext,
  input: AttachArtifactInput,
  idempotencyKey: string,
) {
  if (!context.issueId) {
    return null;
  }

  return kanbangerMutation(
    "issueArtifact.create",
    {
      issueId: context.issueId,
      agentTaskRunId: context.taskRunId,
      executionBackend: "bob",
      producerType: "bob",
      producerId: idempotencyKey,
      artifactType: input.artifactType,
      artifactRole: input.artifactRole ?? "other",
      url: input.url,
      title: input.title,
      summary: input.summary,
    },
    idempotencyKey,
  );
}

function formatMilestoneComment(input: ReportMilestoneInput): string | null {
  switch (input.kind) {
    case "progress":
      return null;
    case "blocked":
      return `🚫 **Blocked:** ${input.message}`;
    case "review_ready":
      return `👀 **Ready for review:** ${input.message}`;
    case "completed":
      return `✅ **Completed:** ${input.message}`;
    case "verification_result": {
      const verb = input.verificationResult === "passed" ? "passed" : "failed";
      return `🧪 **Verification ${verb}:** ${input.message}`;
    }
  }
}

function formatArtifactComment(input: AttachArtifactInput): string {
  const label = input.title ?? input.url;
  const summary = input.summary ? `\n\n${input.summary}` : "";
  const role = input.artifactRole
    ? ` (${input.artifactRole.replace(/_/g, " ")})`
    : "";
  return `🔗 **Artifact${role}:** [${label}](${input.url})${summary}`;
}

export async function reportMilestone(input: ReportMilestoneInput) {
  const context = await getSessionTaskContext(input.userId, input.sessionId);

  if (!context.issueId) {
    return;
  }

  if (input.kind === "progress" && context.taskRunId) {
    const syncIdempotencyKey = createIdempotencyKey([
      "agent.syncBobRun.progress",
      context.taskRunId,
      input.message,
      input.phase,
      input.progress,
    ]);
    await syncBobRunProjection(
      context,
      {
        workflowStatus: "working",
        runStatus: "in_progress",
        latestSummary: input.message,
      },
      syncIdempotencyKey,
    );
    return;
  }

  const body = formatMilestoneComment(input);
  if (!body) {
    return;
  }

  await createIssueComment(
    context.issueId,
    body,
    createIdempotencyKey(["comment.milestone", context.issueId, input.kind, body]),
  );
}

export async function requestInputPrompt(input: RequestInputPromptInput) {
  const context = await getSessionTaskContext(input.userId, input.sessionId);
  const optionsText = input.options?.length
    ? `\n\nOptions:\n${input.options.map((option) => `- ${option}`).join("\n")}`
    : "";
  const body =
    `💭 **Question:** ${input.question}${optionsText}\n\n` +
    `Default action: **${input.defaultAction}**\n` +
    `Timeout: ${input.timeoutMinutes} minutes (${input.expiresAt.toISOString()})`;

  const comment = await createIssueComment(
    context.issueId,
    body,
    createIdempotencyKey([
      "comment.prompt",
      context.issueId,
      input.question,
      input.defaultAction,
      input.expiresAt.toISOString(),
    ]),
  );

  await syncBobRunProjection(
    context,
    {
      workflowStatus: "awaiting_input",
      latestSummary: input.question,
      lastPromptCommentId: comment?.id,
    },
    createIdempotencyKey([
      "agent.syncBobRun.awaiting_input",
      context.taskRunId,
      input.question,
      comment?.id,
    ]),
  );
}

export async function recordPromptResolution(
  input: RecordPromptResolutionInput,
) {
  const context = await getSessionTaskContext(input.userId, input.sessionId);
  const prefix =
    input.resolutionType === "timeout"
      ? "⏱️ **Prompt timed out:**"
      : "💬 **Input received:**";

  await createIssueComment(
    context.issueId,
    `${prefix} ${input.value}`,
    createIdempotencyKey([
      "comment.prompt-resolution",
      context.issueId,
      input.resolutionType,
      input.value,
    ]),
  );
}

export async function setIssueStatus(input: SetIssueStatusInput) {
  const context = await getSessionTaskContext(input.userId, input.sessionId);

  if (!context.issueId || input.status === "blocked") {
    return;
  }

  const remoteStatus = input.status;

  await kanbangerMutation(
    "issue.update",
    {
      id: context.issueId,
      status: remoteStatus,
    },
    createIdempotencyKey(["issue.update", context.issueId, remoteStatus]),
  );
}

export async function attachArtifact(input: AttachArtifactInput) {
  const context = await getSessionTaskContext(input.userId, input.sessionId);
  const artifactIdempotencyKey = createIdempotencyKey([
    "issueArtifact.create",
    context.issueId,
    context.taskRunId,
    input.artifactType,
    input.artifactRole,
    input.url,
  ]);

  await createCanonicalArtifact(
    context,
    input,
    artifactIdempotencyKey,
  );

  await createIssueComment(
    context.issueId,
    formatArtifactComment(input),
    createIdempotencyKey([
      "comment.artifact",
      context.issueId,
      input.artifactType,
      input.artifactRole,
      input.url,
    ]),
  );
}

export async function markRunReviewReady(input: MarkRunReviewReadyInput) {
  await setIssueStatus({
    userId: input.userId,
    sessionId: input.sessionId,
    status: "in_review",
  });
  await attachArtifact({
    userId: input.userId,
    sessionId: input.sessionId,
    artifactType: "pr",
    artifactRole: "review",
    url: input.prUrl,
    title: "Pull request",
    summary: input.summary,
  });

  const commentBody = input.notesForReviewer
    ? `${input.summary}\n\nNotes for reviewer:\n${input.notesForReviewer}`
    : input.summary;

  await syncBobRunProjection(
    await getSessionTaskContext(input.userId, input.sessionId),
    {
      workflowStatus: "awaiting_review",
      runStatus: "in_progress",
      latestSummary: input.summary,
      reviewUrl: input.prUrl,
      issueStatus: "in_review",
    },
    createIdempotencyKey([
      "agent.syncBobRun.review_ready",
      input.sessionId,
      input.prUrl,
      input.summary,
    ]),
  );

  await reportMilestone({
    userId: input.userId,
    sessionId: input.sessionId,
    kind: "review_ready",
    message: commentBody,
  });
}

export async function completeTaskRun(input: CompleteTaskRunInput) {
  const context = await getSessionTaskContext(input.userId, input.sessionId);

  if (!context.taskRunId) {
    throw new Error("No active task run for this session");
  }

  await kanbangerMutation(
    "agent.completeTask",
    {
      taskRunId: context.taskRunId,
      result: {
        success: true,
        summary: input.summary,
        artifacts: input.prUrl
          ? [
              {
                type: "pr",
                url: input.prUrl,
                description: "Pull request",
              },
            ]
          : undefined,
      },
      markIssueDone: false,
    },
    createIdempotencyKey([
      "agent.completeTask",
      context.taskRunId,
      input.summary,
      input.prUrl,
    ]),
  );

  if (input.prUrl) {
    await attachArtifact({
      userId: input.userId,
      sessionId: input.sessionId,
      artifactType: "pr",
      artifactRole: "review",
      url: input.prUrl,
      title: "Pull request",
      summary: input.summary,
    });
  }

  await syncBobRunProjection(
    context,
    {
      workflowStatus: "completed",
      runStatus: "completed",
      latestSummary: input.summary,
    },
    createIdempotencyKey([
      "agent.syncBobRun.completed",
      context.taskRunId,
      input.summary,
      input.prUrl,
    ]),
  );

  await reportMilestone({
    userId: input.userId,
    sessionId: input.sessionId,
    kind: "completed",
    message: input.summary,
  });
}

export async function recordVerificationResult(
  input: RecordVerificationResultInput,
) {
  if (input.artifactUrl) {
    await attachArtifact({
      userId: input.userId,
      sessionId: input.sessionId,
      artifactType: "verification",
      artifactRole: "verification",
      url: input.artifactUrl,
      title: "Verification artifact",
      summary: input.summary,
    });
  }

  await reportMilestone({
    userId: input.userId,
    sessionId: input.sessionId,
    kind: "verification_result",
    message: input.summary,
    verificationResult: input.result,
  });
}

export async function markRunCompletedAfterMerge(
  input: MarkRunCompletedAfterMergeInput,
) {
  await setIssueStatus({
    userId: input.userId,
    sessionId: input.sessionId,
    status: "done",
  });

  if (input.prUrl) {
    await attachArtifact({
      userId: input.userId,
      sessionId: input.sessionId,
      artifactType: "pr",
      artifactRole: "primary",
      url: input.prUrl,
      title: "Merged pull request",
      summary: input.summary,
    });
  }

  await reportMilestone({
    userId: input.userId,
    sessionId: input.sessionId,
    kind: "completed",
    message: input.summary,
  });
}
