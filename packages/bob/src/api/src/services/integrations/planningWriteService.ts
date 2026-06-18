import { and, desc, eq } from "@bob/db";
import { db } from "@bob/db/client";
import { chatConversations, projects, taskRuns, workItems } from "@bob/db/schema";

import {
  resolvePlanningProvider,
  type PlanningProvider,
} from "./planningProvider.js";

export type PlanningIssueStatus =
  | "todo"
  | "in_progress"
  | "in_review"
  | "done"
  | "blocked";

export type PlanningMilestoneKind =
  | "progress"
  | "blocked"
  | "review_ready"
  | "verification_result"
  | "completed";

export type PlanningArtifactType =
  | "pr"
  | "verification"
  | "build"
  | "test_report"
  | "doc"
  | "deliverable"
  | "other";

export type PlanningArtifactRole =
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
  bobWorkItemId: string | null;
  taskRunId: string | null;
  issueIdentifier: string | null;
  planningProvider: string;
  workspaceId: string | null;
  projectId: string | null;
}

interface SessionScopedInput {
  userId: string;
  sessionId: string;
}

export interface ReportMilestoneInput extends SessionScopedInput {
  kind: PlanningMilestoneKind;
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
  status: PlanningIssueStatus;
}

export interface AttachArtifactInput extends SessionScopedInput {
  artifactType: PlanningArtifactType;
  artifactRole?: PlanningArtifactRole;
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

// ---------------------------------------------------------------------------
// Context resolution
// ---------------------------------------------------------------------------

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

  const bobWorkItemId =
    session.workItemId ??
    session.planningTaskId ??
    taskRun?.workItemId ??
    taskRun?.planningItemId ??
    null;
  const workItem = bobWorkItemId
    ? await db.query.workItems.findFirst({
        where: eq(workItems.id, bobWorkItemId),
      })
    : null;
  const providerIssueId =
    workItem?.externalProvider === "linear" && workItem.externalId
      ? workItem.externalId
      : bobWorkItemId;

  return {
    sessionId: session.id,
    issueId: providerIssueId,
    bobWorkItemId,
    taskRunId: taskRun?.id ?? null,
    issueIdentifier:
      session.workItemIdentifierSnapshot ??
      taskRun?.workItemIdentifierSnapshot ??
      taskRun?.planningItemIdentifier ??
      null,
    planningProvider: (taskRun as any)?.planningProvider ?? "internal",
    workspaceId: (taskRun as any)?.planningWorkspaceId ?? null,
    projectId: null,
  };
}

async function resolveProvider(context: SessionTaskContext): Promise<PlanningProvider | null> {
  if (!context.workspaceId) return null;

  const project = await db
    .select({
      planningProvider: projects.planningProvider,
      linearProjectId: projects.linearProjectId,
    })
    .from(projects)
    .where(eq(projects.workspaceId, context.workspaceId))
    .then((rows: any[]) => rows[0]);

  if (!project) return null;

  try {
    return await resolvePlanningProvider(db, project, context.workspaceId);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Status mapping
// ---------------------------------------------------------------------------

function mapStatusToProvider(status: PlanningIssueStatus): "started" | "review_ready" | "completed" | null {
  switch (status) {
    case "in_progress": return "started";
    case "in_review": return "review_ready";
    case "done": return "completed";
    default: return null;
  }
}

// ---------------------------------------------------------------------------
// Public API — delegates to PlanningProvider
// ---------------------------------------------------------------------------

export async function reportMilestone(input: ReportMilestoneInput) {
  const context = await getSessionTaskContext(input.userId, input.sessionId);
  if (!context.issueId || !context.taskRunId) return;

  const provider = await resolveProvider(context);
  if (!provider) return;

  await provider.reportMilestone(context.issueId, context.taskRunId, {
    title: input.kind,
    body: input.message,
  });
}

export async function requestInputPrompt(input: RequestInputPromptInput) {
  const context = await getSessionTaskContext(input.userId, input.sessionId);
  if (!context.issueId || !context.taskRunId) return;

  const provider = await resolveProvider(context);
  if (!provider) return;

  await provider.requestInput(context.issueId, context.taskRunId, {
    promptId: `${context.sessionId}-${Date.now()}`,
    question: input.question,
    options: input.options,
  });
}

export async function recordPromptResolution(input: RecordPromptResolutionInput) {
  const context = await getSessionTaskContext(input.userId, input.sessionId);
  if (!context.issueId || !context.taskRunId) return;

  const provider = await resolveProvider(context);
  if (!provider) return;

  await provider.resolveInput(context.issueId, context.taskRunId, {
    promptId: `${context.sessionId}-resolution`,
    answer: input.value,
  });
}

export async function setIssueStatus(input: SetIssueStatusInput) {
  const context = await getSessionTaskContext(input.userId, input.sessionId);
  if (!context.issueId || !context.taskRunId) return;

  const providerStatus = mapStatusToProvider(input.status);
  if (!providerStatus) return;

  const provider = await resolveProvider(context);
  if (!provider) return;

  await provider.setStatus(context.issueId, context.taskRunId, providerStatus);
}

export async function attachArtifact(input: AttachArtifactInput) {
  const context = await getSessionTaskContext(input.userId, input.sessionId);
  if (!context.issueId || !context.taskRunId) return;

  const provider = await resolveProvider(context);
  if (!provider) return;

  await provider.attachArtifact(context.issueId, context.taskRunId, {
    type: input.artifactType,
    role: input.artifactRole ?? "other",
    title: input.title ?? input.url,
    url: input.url,
    summary: input.summary,
  });
}

export async function markRunReviewReady(input: MarkRunReviewReadyInput) {
  const context = await getSessionTaskContext(input.userId, input.sessionId);
  if (!context.issueId || !context.taskRunId) return;

  const provider = await resolveProvider(context);
  if (!provider) return;

  await provider.markReviewReady(context.issueId, context.taskRunId, input.summary);

  await provider.attachArtifact(context.issueId, context.taskRunId, {
    type: "pr",
    role: "review",
    title: "Pull request",
    url: input.prUrl,
    summary: input.summary,
  });
}

export async function completeTaskRun(input: CompleteTaskRunInput) {
  const context = await getSessionTaskContext(input.userId, input.sessionId);
  if (!context.issueId || !context.taskRunId) return;

  const provider = await resolveProvider(context);
  if (!provider) return;

  await provider.completeTask(context.issueId, context.taskRunId, {
    outcome: "success",
    summary: input.summary,
  });

  if (input.prUrl) {
    await provider.attachArtifact(context.issueId, context.taskRunId, {
      type: "pr",
      role: "review",
      title: "Pull request",
      url: input.prUrl,
      summary: input.summary,
    });
  }
}

export async function recordVerificationResult(input: RecordVerificationResultInput) {
  const context = await getSessionTaskContext(input.userId, input.sessionId);
  if (!context.issueId || !context.taskRunId) return;

  const provider = await resolveProvider(context);
  if (!provider) return;

  if (input.artifactUrl) {
    await provider.attachArtifact(context.issueId, context.taskRunId, {
      type: "verification",
      role: "verification",
      title: "Verification artifact",
      url: input.artifactUrl,
      summary: input.summary,
    });
  }

  await provider.reportMilestone(context.issueId, context.taskRunId, {
    title: "verification_result",
    body: `Verification ${input.result}: ${input.summary}`,
  });
}

export async function markRunCompletedAfterMerge(input: MarkRunCompletedAfterMergeInput) {
  const context = await getSessionTaskContext(input.userId, input.sessionId);
  if (!context.issueId || !context.taskRunId) return;

  const provider = await resolveProvider(context);
  if (!provider) return;

  await provider.setStatus(context.issueId, context.taskRunId, "completed");

  if (input.prUrl) {
    await provider.attachArtifact(context.issueId, context.taskRunId, {
      type: "pr",
      role: "primary",
      title: "Merged pull request",
      url: input.prUrl,
      summary: input.summary,
    });
  }

  await provider.reportMilestone(context.issueId, context.taskRunId, {
    title: "completed",
    body: input.summary,
  });
}
