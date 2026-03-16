import { desc, eq, or } from "@bob/db";
import { db } from "@bob/db/client";
import {
  chatConversations,
  taskRuns,
  user,
} from "@bob/db/schema";
import {
  taskRunStatusEnum,
  type TaskRunStatus,
  type WorkflowStatus,
} from "@bob/db/schema";

import {
  executeTask,
  markTaskBlocked,
  resumeBlockedTask,
} from "./taskExecutor";
import type { PlanningTask } from "./taskExecutor";

export interface PlanningControlActor {
  id: string;
  name?: string;
  email?: string;
}

export interface StartIssueSessionInput {
  workspaceId: string;
  projectId: string;
  issueId: string;
  issueIdentifier: string;
  title?: string;
  description?: string;
  labels?: string[];
  priority?: number;
  actor: PlanningControlActor;
  repository?: PlanningTask["repository"];
}

export interface ResumeIssueSessionInput {
  workspaceId: string;
  projectId: string;
  issueId: string;
  issueIdentifier: string;
  actor: PlanningControlActor;
  message?: string;
}

export interface StopIssueSessionInput {
  workspaceId: string;
  projectId: string;
  issueId: string;
  issueIdentifier: string;
  actor: PlanningControlActor;
  reason?: string;
}

export interface GetIssueSessionInput {
  workspaceId: string;
  projectId: string;
  issueId: string;
  issueIdentifier?: string;
}

export interface IssueSessionSnapshot {
  issueId: string;
  issueIdentifier: string;
  executionBackend: "bob";
  taskRunId: string | null;
  sessionId: string | null;
  sessionUrl: string | null;
  workflowStatus: WorkflowStatus | null;
  sessionStatus: string | null;
  runStatus: TaskRunStatus | null;
  latestSummary: string | null;
  repository: {
    id: string;
    name: string;
    path: string;
    mainBranch: string;
  } | null;
  worktree: {
    id: string | null;
    path: string | null;
    branch: string | null;
  } | null;
}

const SITE_BASE_URL = "http://localhost:3000";
const DEFAULT_CONTROL_USER_ID = "default-user";

async function ensureControlUserId(
  actor: PlanningControlActor,
): Promise<string> {
  if (actor.email) {
    const mappedUser = await db.query.user.findFirst({
      where: eq(user.email, actor.email),
    });

    if (mappedUser) {
      return mappedUser.id;
    }
  }

  const existingDefaultUser = await db.query.user.findFirst({
    where: eq(user.id, DEFAULT_CONTROL_USER_ID),
  });
  if (existingDefaultUser) {
    return existingDefaultUser.id;
  }

  await db
    .insert(user)
    .values({
      id: DEFAULT_CONTROL_USER_ID,
      email: actor.email ?? "default-user@example.com",
      name: actor.name ?? "Default User",
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    .onConflictDoNothing();

  return DEFAULT_CONTROL_USER_ID;
}

async function getLatestTaskRunForIssue(planningItemId: string) {
  return db.query.taskRuns.findFirst({
    where: or(
      eq(taskRuns.workItemId, planningItemId),
      eq(taskRuns.planningItemId, planningItemId),
    ),
    with: {
      repository: true,
      session: true,
      worktree: true,
    },
    orderBy: desc(taskRuns.createdAt),
  });
}

function buildSessionUrl(sessionId: string | null): string | null {
  if (!sessionId) {
    return null;
  }

  return new URL(`/chat?session=${sessionId}`, SITE_BASE_URL).toString();
}

function emptyIssueSessionSnapshot(
  input: Pick<GetIssueSessionInput, "issueId" | "issueIdentifier">,
): IssueSessionSnapshot {
  return {
    issueId: input.issueId,
    issueIdentifier: input.issueIdentifier ?? input.issueId,
    executionBackend: "bob",
    taskRunId: null,
    sessionId: null,
    sessionUrl: null,
    workflowStatus: null,
    sessionStatus: null,
    runStatus: null,
    latestSummary: null,
    repository: null,
    worktree: null,
  };
}

function buildIssueSessionSnapshot(
  taskRun:
    | Awaited<ReturnType<typeof getLatestTaskRunForIssue>>
    | null,
  fallback: Pick<GetIssueSessionInput, "issueId" | "issueIdentifier">,
): IssueSessionSnapshot {
  if (!taskRun) {
    return emptyIssueSessionSnapshot(fallback);
  }

  return {
    issueId: taskRun.workItemId ?? taskRun.planningItemId,
    issueIdentifier:
      fallback.issueIdentifier ??
      taskRun.workItemIdentifierSnapshot ??
      taskRun.planningItemIdentifier,
    executionBackend: "bob",
    taskRunId: taskRun.id,
    sessionId: taskRun.sessionId,
    sessionUrl: buildSessionUrl(taskRun.sessionId),
    workflowStatus:
      (taskRun.session?.workflowStatus as WorkflowStatus | null | undefined) ??
      null,
    sessionStatus: taskRun.session?.status ?? null,
    runStatus: (taskRunStatusEnum as readonly string[]).includes(taskRun.status)
      ? (taskRun.status as TaskRunStatus)
      : null,
    latestSummary: taskRun.session?.statusMessage ?? taskRun.blockedReason,
    repository: taskRun.repository
      ? {
          id: taskRun.repository.id,
          name: taskRun.repository.name,
          path: taskRun.repository.path,
          mainBranch: taskRun.repository.mainBranch,
        }
      : null,
    worktree: {
      id: taskRun.worktree?.id ?? null,
      path:
        taskRun.worktree?.path ??
        taskRun.session?.workingDirectory ??
        taskRun.repository?.path ??
        null,
      branch: taskRun.worktree?.branch ?? taskRun.branch ?? null,
    },
  };
}

export async function getIssueSessionSnapshot(
  input: GetIssueSessionInput,
): Promise<IssueSessionSnapshot> {
  const latestTaskRun = await getLatestTaskRunForIssue(input.issueId);
  return buildIssueSessionSnapshot(latestTaskRun, input);
}

export async function startIssueSession(
  input: StartIssueSessionInput,
): Promise<IssueSessionSnapshot> {
  const latestTaskRun = await getLatestTaskRunForIssue(input.issueId);

  if (
    latestTaskRun &&
    (latestTaskRun.status === "starting" || latestTaskRun.status === "running")
  ) {
    return buildIssueSessionSnapshot(latestTaskRun, input);
  }

  const userId = await ensureControlUserId(input.actor);

  await executeTask(userId, {
    id: input.issueId,
    identifier: input.issueIdentifier,
    title: input.title ?? input.issueIdentifier,
    description: input.description ?? null,
    workspaceId: input.workspaceId,
    projectId: input.projectId,
    assigneeId: input.actor.id,
    labels: input.labels ?? [],
    priority: input.priority ?? 0,
    repository: input.repository,
  });

  return getIssueSessionSnapshot(input);
}

export async function resumeIssueSession(
  input: ResumeIssueSessionInput,
): Promise<IssueSessionSnapshot> {
  const latestTaskRun = await getLatestTaskRunForIssue(input.issueId);

  if (!latestTaskRun) {
    return startIssueSession(input);
  }

  if (latestTaskRun.status === "blocked") {
    await resumeBlockedTask(latestTaskRun.id, input.message);
  }

  return getIssueSessionSnapshot(input);
}

export async function stopIssueSession(
  input: StopIssueSessionInput,
): Promise<IssueSessionSnapshot> {
  const latestTaskRun = await getLatestTaskRunForIssue(input.issueId);

  if (!latestTaskRun) {
    return emptyIssueSessionSnapshot(input);
  }

  const reason =
    input.reason?.trim() ?? "Stopped from planning and moved to blocked";

  await markTaskBlocked(latestTaskRun.id, reason);

  if (latestTaskRun.sessionId) {
    await db
      .update(chatConversations)
      .set({
        workflowStatus: "blocked",
        statusMessage: reason,
        updatedAt: new Date(),
      })
      .where(eq(chatConversations.id, latestTaskRun.sessionId));
  }

  return getIssueSessionSnapshot(input);
}
