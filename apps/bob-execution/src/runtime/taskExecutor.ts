import { and, desc, eq } from "@bob/db";
import { db } from "@bob/db/client";
import {
  chatConversations,
  chatMessages,
  forgeRevisions,
  forgeRunEvents,
  repositories,
  runLifecycleEvents,
  taskRuns,
} from "@bob/db/schema";
import { buildBobExternalTaskMetadata } from "./externalTaskMetadata.js";
import { applySnapshotToTask, snapshotTaskFromProvider } from "./providerSnapshot.js";
import {
  buildT3ThreadTurnStartCommand,
  dispatchTaskToT3Code,
  getT3DispatchRuntimeConfig,
} from "./t3DispatchClient.js";

function getGatewayUrl() {
  return (globalThis as any).GATEWAY_URL ?? process.env.GATEWAY_URL ?? "http://localhost:3002";
}

function getNudgeSecret(): string | undefined {
  return (globalThis as any).NUDGE_SHARED_SECRET ?? process.env.NUDGE_SHARED_SECRET;
}

function getExecutionBackend(): "gateway" | "t3code" {
  const backend =
    (globalThis as any).BOB_EXECUTION_BACKEND ?? process.env.BOB_EXECUTION_BACKEND;
  return backend === "t3code" ? "t3code" : "gateway";
}

export interface PlanningTask {
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
  externalId?: string | null;
  externalProvider?: string | null;
  linearWebBaseUrl?: string | null;
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

function expectInsertedRow<T>(row: T | undefined, message: string): T {
  if (!row) {
    throw new Error(message);
  }

  return row;
}

export async function gatewayRequest(
  userId: string,
  endpoint: string,
  body: Record<string, unknown>,
): Promise<unknown> {
  const gatewayUrl = getGatewayUrl();
  const nudgeSecret = getNudgeSecret();

  // Route /session/send through ws-gateway's /internal/session-send
  if (endpoint === "/session/send" && nudgeSecret) {
    const response = await fetch(`${gatewayUrl}/internal/session-send`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${nudgeSecret}`,
      },
      body: JSON.stringify({
        userId,
        sessionId: body.sessionId,
        message: body.message,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Gateway session-send error: ${error}`);
    }

    return response.json();
  }

  // Fallback for other endpoints (shouldn't happen in current code)
  const response = await fetch(`${gatewayUrl}${endpoint}`, {
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

function generateBranchName(task: PlanningTask): string {
  const slug = slugify(task.title);
  return `bob/${task.identifier}/${slug}`;
}

export async function findRepositoryForTask(
  userId: string,
  task: PlanningTask,
): Promise<{ repositoryId: string; path: string; mainBranch: string } | null> {
  const repos = await db.query.repositories.findMany({
    where: eq(repositories.userId, userId),
  });

  if (repos.length === 0) return null;

  if (task.repository?.id) {
    const exactMatch = repos.find(
      (repo: typeof repositories.$inferSelect) => repo.id === task.repository?.id,
    );
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
      (repo: typeof repositories.$inferSelect) =>
        repo.remoteOwner === owner && repo.remoteName === name,
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
    (repo: typeof repositories.$inferSelect) =>
      repo.planningProjectId === task.projectId,
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
    const matchingRepo = repos.find((repo: typeof repositories.$inferSelect) => {
      const normalizedName = repo.name.toLowerCase().replace(/[^a-z0-9]/g, "");
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
  task: PlanningTask,
  options?: {
    contextPreamble?: string;
    agentType?: string;
    planningProvider?: string;
  },
): Promise<TaskExecutionResult> {
  // Resolve the planning provider and snapshot fresh task details.
  // This ensures the executor works with the latest title/description/labels
  // from the upstream source (Linear, internal work items, etc.).
  const providerResult = await snapshotTaskFromProvider(task, options?.planningProvider);
  const resolvedProvider = providerResult.provider;

  if (providerResult.snapshot) {
    applySnapshotToTask(task, providerResult.snapshot);
  } else if (providerResult.error) {
    console.warn(
      `[taskExecutor] Provider snapshot failed (provider=${resolvedProvider}): ${providerResult.error}. Proceeding with caller-supplied task details.`,
    );
  }

  const repoInfo = await findRepositoryForTask(userId, task);

  if (!repoInfo) {
    const [taskRun] = await db
      .insert(taskRuns)
      .values({
        userId,
        workItemId: task.id,
        workItemIdentifierSnapshot: task.identifier,
        planningWorkspaceId: task.workspaceId,
        planningItemId: task.id,
        planningItemIdentifier: task.identifier,
        planningProvider: resolvedProvider,
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
  const selectedAgent = options?.agentType ?? "opencode";
  const executionBackend = getExecutionBackend();
  const t3RuntimeConfig =
    executionBackend === "t3code" ? getT3DispatchRuntimeConfig() : null;
  if (executionBackend === "t3code" && !t3RuntimeConfig) {
    throw new Error(
      "BOB_EXECUTION_BACKEND=t3code requires T3CODE_SERVER_URL, T3CODE_PROJECT_ID, T3CODE_MODEL_INSTANCE_ID, and T3CODE_MODEL",
    );
  }

  // Create session and task run in DB. The daemon handles git ops
  // (worktree creation, branch checkout, credential setup) when it
  // receives the session_available nudge.
  const [session] = await db
    .insert(chatConversations)
    .values({
      userId,
      repositoryId: repoInfo.repositoryId,
      workingDirectory: repoInfo.path,
      agentType: selectedAgent,
      title: `${task.identifier}: ${task.title}`,
      status: "pending",
      workItemId: task.id,
      workItemIdentifierSnapshot: task.identifier,
      gitBranch: branch,
      planningTaskId: task.id,
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
      workItemId: task.id,
      workItemIdentifierSnapshot: task.identifier,
      planningWorkspaceId: task.workspaceId,
      planningItemId: task.id,
      planningItemIdentifier: task.identifier,
      planningProvider: resolvedProvider,
      sessionId: insertedSession.id,
      repositoryId: repoInfo.repositoryId,
      status: "starting",
      branch,
    })
    .returning();
  const insertedTaskRun = expectInsertedRow(
    taskRun,
    "Failed to create starting task run",
  );
  const externalTask = buildBobExternalTaskMetadata({
    task,
    planningProvider: resolvedProvider,
    taskRunId: insertedTaskRun.id,
  });

  if (executionBackend === "t3code" && t3RuntimeConfig) {
    try {
      const command = buildT3ThreadTurnStartCommand({
        task,
        taskRunId: insertedTaskRun.id,
        branch,
        workingDirectory: repoInfo.path,
        baseBranch: repoInfo.mainBranch,
        externalTask,
        config: t3RuntimeConfig,
      });
      await dispatchTaskToT3Code({
        serverUrl: t3RuntimeConfig.serverUrl,
        authToken: t3RuntimeConfig.authToken,
        command,
      });
    } catch (err) {
      await db
        .update(taskRuns)
        .set({
          status: "failed",
          blockedReason: err instanceof Error ? err.message : String(err),
        })
        .where(eq(taskRuns.id, insertedTaskRun.id));
      throw err;
    }
  } else {
    // Nudge ws-gateway so the daemon picks up the session immediately.
    // Same pattern as planSession.start — best-effort, daemon will also
    // discover pending sessions on reconnect.
    const gatewayUrl = getGatewayUrl();
    const nudgeSecret = getNudgeSecret();
    if (nudgeSecret) {
      try {
        await fetch(`${gatewayUrl}/internal/nudge`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${nudgeSecret}`,
          },
          body: JSON.stringify({
            sessionId: insertedSession.id,
            workspaceId: task.workspaceId,
            workingDirectory: repoInfo.path,
            agentType: selectedAgent,
            title: `${task.identifier}: ${task.title}`,
            sessionType: "execution",
            description: task.description ?? undefined,
            identifier: task.identifier,
            branch,
            externalTask,
          }),
        });
      } catch (err) {
        console.warn("[taskExecutor] nudge failed:", err);
      }
    }
  }

  // Fire-and-forget: write run_started lifecycle event
  void db.insert(runLifecycleEvents).values({
    taskRunId: insertedTaskRun.id,
    workItemId: task.id,
    sessionId: insertedSession.id,
    eventType: "run_started",
    phase: "execute",
    metadata: {
      agentType: selectedAgent,
      branch,
      taskIdentifier: task.identifier,
      externalTask,
    },
  }).catch((err: unknown) =>
    console.warn("[taskExecutor] Failed to write run_started lifecycle event:", err),
  );

  // Report to ForgeGraph (fire and forget)
  void reportForgeGraphCreated(db, {
    id: insertedTaskRun.id,
    repositoryId: repoInfo.repositoryId,
    branch,
    planningItemId: task.id,
    workItemId: task.id,
  });

  return {
    taskRunId: insertedTaskRun.id,
    sessionId: insertedSession.id,
    worktreeId: null,
    branch,
    status: "starting",
  };
}

export async function markTaskBlocked(
  taskRunId: string,
  reason: string,
): Promise<void> {
  const [updated] = await db
    .update(taskRuns)
    .set({
      status: "blocked",
      blockedReason: reason,
    })
    .where(and(eq(taskRuns.id, taskRunId), eq(taskRuns.status, "running")))
    .returning({ sessionId: taskRuns.sessionId });

  if (updated?.sessionId) {
    await db
      .update(chatConversations)
      .set({ blockedReason: reason })
      .where(eq(chatConversations.id, updated.sessionId));
  }
}

export async function resumeBlockedTask(
  taskRunId: string,
  additionalContext?: string,
): Promise<void> {
  const [updated] = await db
    .update(taskRuns)
    .set({
      status: "running",
      blockedReason: null,
    })
    .where(and(eq(taskRuns.id, taskRunId), eq(taskRuns.status, "blocked")))
    .returning({ sessionId: taskRuns.sessionId, userId: taskRuns.userId });

  if (!updated?.sessionId) {
    return;
  }

  await db
    .update(chatConversations)
    .set({ blockedReason: null })
    .where(eq(chatConversations.id, updated.sessionId));

  if (additionalContext) {
    try {
      await gatewayRequest(updated.userId, "/session/send", {
        sessionId: updated.sessionId,
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
      completedAt: new Date().toISOString(),
    })
    .where(eq(taskRuns.id, taskRunId));
}

export async function getTaskRunByPlanningItemId(
  planningItemId: string,
): Promise<typeof taskRuns.$inferSelect | null> {
  const taskRun = await db.query.taskRuns.findFirst({
    where: and(
      eq(taskRuns.planningItemId, planningItemId),
      eq(taskRuns.status, "blocked"),
    ),
    orderBy: desc(taskRuns.createdAt),
  });

  return taskRun ?? null;
}

export async function getLatestTaskRunByPlanningItemId(
  planningItemId: string,
): Promise<typeof taskRuns.$inferSelect | null> {
  const taskRun = await db.query.taskRuns.findFirst({
    where: eq(taskRuns.planningItemId, planningItemId),
    orderBy: desc(taskRuns.createdAt),
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
  task: PlanningTask,
  changes: IssueContextFieldChange[],
): Promise<TaskExecutionResult | null> {
  const taskRun = await db.query.taskRuns.findFirst({
    where: eq(taskRuns.id, taskRunId),
  });

  if (!taskRun) {
    return null;
  }

  const reason =
    "Superseded by planning issue context update requiring a fresh run";

  // Create the new task run FIRST — if this fails, the old task keeps its
  // current status rather than being orphaned with no replacement.
  const result = await executeTask(taskRun.userId, task, {
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

  // Only mark the old task as failed after the new one is successfully created.
  await db
    .update(taskRuns)
    .set({
      status: "failed",
      blockedReason: reason,
      completedAt: new Date().toISOString(),
    })
    .where(eq(taskRuns.id, taskRunId));

  if (taskRun.sessionId) {
    await db
      .update(chatConversations)
      .set({
        status: "stopped",
        blockedReason: reason,
        statusMessage: reason,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(chatConversations.id, taskRun.sessionId));
  }

  return result;
}

/** Fire-and-forget: create a ForgeGraph revision + "created" event for a new task run. */
async function reportForgeGraphCreated(
  database: typeof db,
  taskRun: {
    id: string;
    repositoryId: string | null;
    branch: string | null;
    forgegraphRevisionId?: string | null;
    planningItemId: string;
    workItemId?: string | null;
  },
): Promise<void> {
  try {
    if (!taskRun.repositoryId) return;

    // Prefer the VCS-specific revision ID (commit SHA or jj change ID), fall back to branch name
    const revId = taskRun.forgegraphRevisionId ?? taskRun.branch ?? taskRun.id;

    const [revision] = await database
      .insert(forgeRevisions)
      .values({
        repoId: taskRun.repositoryId,
        revId,
        taskId: taskRun.workItemId ?? null,
        taskRunId: taskRun.id,
        branch: taskRun.branch,
      })
      .onConflictDoUpdate({
        target: [forgeRevisions.repoId, forgeRevisions.revId],
        set: { taskRunId: taskRun.id, branch: taskRun.branch },
      })
      .returning();

    if (!revision) return;

    await database.insert(forgeRunEvents).values({
      runId: taskRun.id,
      repoId: taskRun.repositoryId,
      revisionId: revision.id,
      eventType: "created",
      taskId: taskRun.workItemId ?? null,
    });

    console.log(`[forgegraph] Reported 'created' for task run ${taskRun.id}`);
  } catch (err) {
    console.error(`[forgegraph] Failed to report 'created' for ${taskRun.id}:`, err);
  }
}
