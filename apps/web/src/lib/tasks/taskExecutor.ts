import { and, eq } from "@bob/db";
import { db } from "@bob/db/client";
import {
  chatConversations,
  chatMessages,
  repositories,
  taskRuns,
} from "@bob/db/schema";

import { env } from "~/env";

const GATEWAY_URL = env.GATEWAY_URL ?? "http://localhost:3002";

export interface KanbangerTask {
  id: string;
  identifier: string;
  title: string;
  description: string | null;
  workspaceId: string;
  projectId: string;
  assigneeId: string | null;
  labels: string[];
  priority: number;
  url?: string;
  repository?: {
    id?: string;
    fullName?: string;
    url?: string;
    defaultBranch?: string;
  };
}

export interface TaskExecutionResult {
  taskRunId: string;
  sessionId: string;
  worktreeId: string | null;
  branch: string;
  status: "starting" | "running" | "blocked" | "failed";
  blockedReason?: string;
}

export interface IssueContextFieldChange {
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
}

function expectInsertedRow<T>(
  row: T | undefined,
  message: string,
): T {
  if (!row) {
    throw new Error(message);
  }

  return row;
}

async function gatewayRequest(
  userId: string,
  endpoint: string,
  body: Record<string, unknown>,
): Promise<unknown> {
  const response = await fetch(`${GATEWAY_URL}${endpoint}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userId, ...body }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Gateway error: ${error}`);
  }

  return response.json();
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .replace(/[\s_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50);
}

function generateBranchName(task: KanbangerTask): string {
  const slug = slugify(task.title);
  return `bob/${task.identifier}/${slug}`;
}

export async function findRepositoryForTask(
  userId: string,
  task: KanbangerTask,
): Promise<{ repositoryId: string; path: string; mainBranch: string } | null> {
  const repos = await db.query.repositories.findMany({
    where: eq(repositories.userId, userId),
  });

  if (repos.length === 0) return null;

  if (task.repository?.id) {
    const exactMatch = repos.find((repo) => repo.id === task.repository?.id);
    if (exactMatch) {
      return {
        repositoryId: exactMatch.id,
        path: exactMatch.path,
        mainBranch: exactMatch.mainBranch,
      };
    }
  }

  if (task.repository?.fullName) {
    const [owner, name] = task.repository.fullName.split("/");
    const fullNameMatch = repos.find(
      (repo) => repo.remoteOwner === owner && repo.remoteName === name,
    );
    if (fullNameMatch) {
      return {
        repositoryId: fullNameMatch.id,
        path: fullNameMatch.path,
        mainBranch: fullNameMatch.mainBranch,
      };
    }
  }

  const projectMappedRepo = repos.find(
    (repo) => repo.kanbangerProjectId === task.projectId,
  );
  if (projectMappedRepo) {
    return {
      repositoryId: projectMappedRepo.id,
      path: projectMappedRepo.path,
      mainBranch: projectMappedRepo.mainBranch,
    };
  }

  if (repos.length === 1) {
    const repo = repos[0];
    if (!repo) {
      return null;
    }
    return {
      repositoryId: repo.id,
      path: repo.path,
      mainBranch: repo.mainBranch,
    };
  }

  for (const label of task.labels) {
    const normalizedLabel = label.toLowerCase().replace(/[^a-z0-9]/g, "");
    const matchingRepo = repos.find((r) => {
      const normalizedName = r.name.toLowerCase().replace(/[^a-z0-9]/g, "");
      return (
        normalizedName.includes(normalizedLabel) ||
        normalizedLabel.includes(normalizedName)
      );
    });
    if (matchingRepo) {
      return {
        repositoryId: matchingRepo.id,
        path: matchingRepo.path,
        mainBranch: matchingRepo.mainBranch,
      };
    }
  }

  const firstRepo = repos[0];
  if (!firstRepo) {
    return null;
  }
  return {
    repositoryId: firstRepo.id,
    path: firstRepo.path,
    mainBranch: firstRepo.mainBranch,
  };
}

export async function executeTask(
  userId: string,
  task: KanbangerTask,
  options?: {
    contextPreamble?: string;
  },
): Promise<TaskExecutionResult> {
  const repoInfo = await findRepositoryForTask(userId, task);

  if (!repoInfo) {
    const [taskRun] = await db
      .insert(taskRuns)
      .values({
        userId,
        kanbangerWorkspaceId: task.workspaceId,
        kanbangerIssueId: task.id,
        kanbangerIssueIdentifier: task.identifier,
        status: "blocked",
        blockedReason: "No repository found for this task",
      })
      .returning();
    const insertedTaskRun = expectInsertedRow(
      taskRun,
      "Failed to create blocked task run",
    );

    return {
      taskRunId: insertedTaskRun.id,
      sessionId: "",
      worktreeId: null,
      branch: "",
      status: "blocked",
      blockedReason: "No repository found for this task",
    };
  }

  const branch = generateBranchName(task);
  const worktreeId: string | null = null;
  const worktreePath = repoInfo.path;

  try {
    await gatewayRequest(userId, "/git/checkout", {
      path: repoInfo.path,
      branch,
      create: true,
    });
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";

    if (!errorMessage.includes("already exists")) {
      const [taskRun] = await db
        .insert(taskRuns)
        .values({
          userId,
          kanbangerWorkspaceId: task.workspaceId,
          kanbangerIssueId: task.id,
          kanbangerIssueIdentifier: task.identifier,
          repositoryId: repoInfo.repositoryId,
          status: "failed",
          blockedReason: `Failed to create branch: ${errorMessage}`,
          branch,
        })
        .returning();
      const insertedTaskRun = expectInsertedRow(
        taskRun,
        "Failed to create failed task run",
      );

      return {
        taskRunId: insertedTaskRun.id,
        sessionId: "",
        worktreeId: null,
        branch,
        status: "failed",
        blockedReason: `Failed to create branch: ${errorMessage}`,
      };
    }
  }

  const prompt = buildInitialPrompt(task, options);

  const [session] = await db
    .insert(chatConversations)
    .values({
      userId,
      repositoryId: repoInfo.repositoryId,
      worktreeId,
      workingDirectory: worktreePath,
      agentType: "opencode",
      title: `${task.identifier}: ${task.title}`,
      status: "provisioning",
      gitBranch: branch,
      kanbangerTaskId: task.id,
    })
    .returning();
  const insertedSession = expectInsertedRow(
    session,
    "Failed to create task session",
  );

  const [taskRun] = await db
    .insert(taskRuns)
    .values({
      userId,
      kanbangerWorkspaceId: task.workspaceId,
      kanbangerIssueId: task.id,
      kanbangerIssueIdentifier: task.identifier,
      sessionId: insertedSession.id,
      repositoryId: repoInfo.repositoryId,
      worktreeId,
      status: "starting",
      branch,
    })
    .returning();
  const insertedTaskRun = expectInsertedRow(
    taskRun,
    "Failed to create starting task run",
  );

  try {
    await gatewayRequest(userId, "/session/start", {
      sessionId: insertedSession.id,
      workingDirectory: worktreePath,
      agentType: "opencode",
      initialPrompt: prompt,
    });
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";

    await db
      .update(taskRuns)
      .set({
        status: "failed",
        blockedReason: `Failed to start session: ${errorMessage}`,
      })
      .where(eq(taskRuns.id, insertedTaskRun.id));

    await db
      .update(chatConversations)
      .set({
        status: "error",
        lastError: {
          code: "TASK_START_FAILED",
          message: errorMessage,
          timestamp: new Date().toISOString(),
        },
      })
      .where(eq(chatConversations.id, insertedSession.id));

    return {
      taskRunId: insertedTaskRun.id,
      sessionId: insertedSession.id,
      worktreeId,
      branch,
      status: "failed",
      blockedReason: `Failed to start session: ${errorMessage}`,
    };
  }

  return {
    taskRunId: insertedTaskRun.id,
    sessionId: insertedSession.id,
    worktreeId,
    branch,
    status: "running",
  };
}

function buildInitialPrompt(
  task: KanbangerTask,
  options?: {
    contextPreamble?: string;
  },
): string {
  const lines: string[] = [];

  lines.push(`# Task: ${task.identifier} - ${task.title}`);
  lines.push("");

  if (options?.contextPreamble) {
    lines.push("## Handoff Context");
    lines.push("");
    lines.push(options.contextPreamble);
    lines.push("");
  }

  if (task.description) {
    lines.push("## Description");
    lines.push("");
    lines.push(task.description);
    lines.push("");
  }

  if (task.labels.length > 0) {
    lines.push(`**Labels:** ${task.labels.join(", ")}`);
    lines.push("");
  }

  lines.push("## Instructions");
  lines.push("");
  lines.push("Please implement this task following these guidelines:");
  lines.push("1. Read and understand the task requirements");
  lines.push("2. Break down the work into logical steps");
  lines.push("3. Implement the changes");
  lines.push("4. Write or update tests as needed");
  lines.push("5. Ensure the code compiles and tests pass");
  lines.push("");
  lines.push(
    "If you encounter any blockers or need clarification, let me know and I will mark the task as blocked.",
  );

  return lines.join("\n");
}

export async function markTaskBlocked(
  taskRunId: string,
  reason: string,
): Promise<void> {
  const taskRun = await db.query.taskRuns.findFirst({
    where: eq(taskRuns.id, taskRunId),
  });

  if (!taskRun) return;

  await db
    .update(taskRuns)
    .set({
      status: "blocked",
      blockedReason: reason,
    })
    .where(eq(taskRuns.id, taskRunId));

  if (taskRun.sessionId) {
    await db
      .update(chatConversations)
      .set({ blockedReason: reason })
      .where(eq(chatConversations.id, taskRun.sessionId));
  }
}

export async function resumeBlockedTask(
  taskRunId: string,
  additionalContext?: string,
): Promise<void> {
  const taskRun = await db.query.taskRuns.findFirst({
    where: eq(taskRuns.id, taskRunId),
  });

  if (!(taskRun?.status === "blocked" && taskRun.sessionId)) {
    return;
  }

  await db
    .update(taskRuns)
    .set({
      status: "running",
      blockedReason: null,
    })
    .where(eq(taskRuns.id, taskRunId));

  await db
    .update(chatConversations)
    .set({ blockedReason: null })
    .where(eq(chatConversations.id, taskRun.sessionId));

  if (additionalContext) {
    try {
      await gatewayRequest(taskRun.userId, "/session/send", {
        sessionId: taskRun.sessionId,
        message: additionalContext,
      });
    } catch (error) {
      console.error("Failed to send context to session:", error);
    }
  }
}

export async function completeTask(taskRunId: string): Promise<void> {
  await db
    .update(taskRuns)
    .set({
      status: "completed",
      completedAt: new Date(),
    })
    .where(eq(taskRuns.id, taskRunId));
}

export async function getTaskRunByKanbangerId(
  kanbangerIssueId: string,
): Promise<typeof taskRuns.$inferSelect | null> {
  const taskRun = await db.query.taskRuns.findFirst({
    where: and(
      eq(taskRuns.kanbangerIssueId, kanbangerIssueId),
      eq(taskRuns.status, "blocked"),
    ),
    orderBy: (t, { desc }) => [desc(t.createdAt)],
  });

  return taskRun ?? null;
}

export async function getLatestTaskRunByKanbangerId(
  kanbangerIssueId: string,
): Promise<typeof taskRuns.$inferSelect | null> {
  const taskRun = await db.query.taskRuns.findFirst({
    where: eq(taskRuns.kanbangerIssueId, kanbangerIssueId),
    orderBy: (t, { desc }) => [desc(t.createdAt)],
  });

  return taskRun ?? null;
}

export function buildIssueContextUpdateMessage(
  issueIdentifier: string,
  changes: IssueContextFieldChange[],
): string {
  const lines = [
    `Issue context update for ${issueIdentifier}:`,
    "",
    "Apply these updated requirements before continuing:",
    "",
    ...changes.map((change) => {
      const fromValue = change.from ?? "(empty)";
      const toValue = change.to ?? "(empty)";
      return `- ${change.field}: ${fromValue} -> ${toValue}`;
    }),
  ];

  return lines.join("\n");
}

async function appendUserContextMessage(sessionId: string, message: string) {
  await db.insert(chatMessages).values({
    conversationId: sessionId,
    role: "user",
    content: message,
  });
}

export async function forwardIssueContextUpdate(
  issueIdentifier: string,
  taskRunId: string,
  changes: IssueContextFieldChange[],
): Promise<void> {
  const taskRun = await db.query.taskRuns.findFirst({
    where: eq(taskRuns.id, taskRunId),
  });

  if (!taskRun?.sessionId) {
    return;
  }

  const message = buildIssueContextUpdateMessage(issueIdentifier, changes);
  await appendUserContextMessage(taskRun.sessionId, message);
  await gatewayRequest(taskRun.userId, "/session/send", {
    sessionId: taskRun.sessionId,
    message,
  });
}

export async function supersedeAndRestartTask(
  taskRunId: string,
  task: KanbangerTask,
  changes: IssueContextFieldChange[],
): Promise<TaskExecutionResult | null> {
  const taskRun = await db.query.taskRuns.findFirst({
    where: eq(taskRuns.id, taskRunId),
  });

  if (!taskRun) {
    return null;
  }

  const reason =
    "Superseded by Kanbanger issue context update requiring a fresh run";

  await db
    .update(taskRuns)
    .set({
      status: "failed",
      blockedReason: reason,
      completedAt: new Date(),
    })
    .where(eq(taskRuns.id, taskRunId));

  if (taskRun.sessionId) {
    await db
      .update(chatConversations)
      .set({
        status: "stopped",
        blockedReason: reason,
        statusMessage: reason,
        updatedAt: new Date(),
      })
      .where(eq(chatConversations.id, taskRun.sessionId));
  }

  return executeTask(taskRun.userId, task, {
    contextPreamble: [
      reason,
      "",
      "Updated issue fields:",
      ...changes.map((change) => {
        const fromValue = change.from ?? "(empty)";
        const toValue = change.to ?? "(empty)";
        return `- ${change.field}: ${fromValue} -> ${toValue}`;
      }),
      "",
      `Previous Bob run branch: ${taskRun.branch ?? "(unknown)"}`,
    ].join("\n"),
  });
}
