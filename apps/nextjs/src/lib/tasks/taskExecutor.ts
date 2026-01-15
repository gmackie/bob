import { and, eq } from "@bob/db";
import { db } from "@bob/db/client";
import { chatConversations, repositories, taskRuns } from "@bob/db/schema";

const GATEWAY_URL = process.env.GATEWAY_URL ?? "http://localhost:3002";

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
}

export interface TaskExecutionResult {
  taskRunId: string;
  sessionId: string;
  worktreeId: string | null;
  branch: string;
  status: "starting" | "running" | "blocked" | "failed";
  blockedReason?: string;
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

  if (repos.length === 1) {
    const repo = repos[0]!;
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

  const firstRepo = repos[0]!;
  return {
    repositoryId: firstRepo.id,
    path: firstRepo.path,
    mainBranch: firstRepo.mainBranch,
  };
}

export async function executeTask(
  userId: string,
  task: KanbangerTask,
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

    return {
      taskRunId: taskRun!.id,
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

      return {
        taskRunId: taskRun!.id,
        sessionId: "",
        worktreeId: null,
        branch,
        status: "failed",
        blockedReason: `Failed to create branch: ${errorMessage}`,
      };
    }
  }

  const prompt = buildInitialPrompt(task);

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

  const [taskRun] = await db
    .insert(taskRuns)
    .values({
      userId,
      kanbangerWorkspaceId: task.workspaceId,
      kanbangerIssueId: task.id,
      kanbangerIssueIdentifier: task.identifier,
      sessionId: session!.id,
      repositoryId: repoInfo.repositoryId,
      worktreeId,
      status: "starting",
      branch,
    })
    .returning();

  try {
    await gatewayRequest(userId, "/session/start", {
      sessionId: session!.id,
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
      .where(eq(taskRuns.id, taskRun!.id));

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
      .where(eq(chatConversations.id, session!.id));

    return {
      taskRunId: taskRun!.id,
      sessionId: session!.id,
      worktreeId,
      branch,
      status: "failed",
      blockedReason: `Failed to start session: ${errorMessage}`,
    };
  }

  return {
    taskRunId: taskRun!.id,
    sessionId: session!.id,
    worktreeId,
    branch,
    status: "running",
  };
}

function buildInitialPrompt(task: KanbangerTask): string {
  const lines: string[] = [];

  lines.push(`# Task: ${task.identifier} - ${task.title}`);
  lines.push("");

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

  if (!taskRun || taskRun.status !== "blocked" || !taskRun.sessionId) return;

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
