import { join } from "node:path";
import {
  createDecipheriv,
  createHmac,
} from "node:crypto";
import { and, desc, eq } from "@bob/db";
import { db } from "@bob/db/client";
import {
  chatConversations,
  chatMessages,
  forgeRevisions,
  forgeRunEvents,
  gitProviderConnections,
  repositories,
  runLifecycleEvents,
  taskRuns,
  worktrees,
} from "@bob/db/schema";
import { buildSmolAgentTaskExecutionProfile } from "./smolAgentProfile";

/** Decrypt a git provider access token (matches tokenVault.ts logic) */
function decryptProviderToken(
  encrypted: { ciphertext: string; iv: string; tag: string },
  connectionId: string,
): string | null {
  const key = process.env.GIT_TOKEN_ENCRYPTION_KEY;
  if (!key || key.length < 32) return null;
  const masterKey = Buffer.from(key.slice(0, 32), "utf8");
  const rowKey = createHmac("sha256", masterKey).update(connectionId).digest().subarray(0, 32);
  const iv = Buffer.from(encrypted.iv, "base64");
  const tag = Buffer.from(encrypted.tag, "base64");
  const ciphertext = Buffer.from(encrypted.ciphertext, "base64");
  const decipher = createDecipheriv("aes-256-gcm", rowKey, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}

const GATEWAY_URL = process.env.GATEWAY_URL ?? "http://localhost:3002";

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

function buildSmolAgentLaunchEnv(
  profileEnv: Record<string, string>,
): Record<string, string> {
  return {
    ...profileEnv,
    BOB_API_URL: process.env.BOB_API_URL ?? "http://localhost:3000",
    ...(process.env.BOB_API_KEY
      ? { BOB_API_KEY: process.env.BOB_API_KEY }
      : {}),
  };
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
  },
): Promise<TaskExecutionResult> {
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
  let worktreeId: string | null = null;
  let worktreePath = repoInfo.path;
  let forgegraphRevisionId: string | null = null;

  // Create an isolated worktree for this task so agents can run in parallel
  const worktreeDirName = `${task.identifier.toLowerCase()}-${Date.now()}`;
  const targetWorktreePath = join(repoInfo.path, "..", ".bob-worktrees", worktreeDirName);

  try {
    const worktreeResult = await gatewayRequest(userId, "/git/worktree", {
      repoPath: repoInfo.path,
      worktreePath: targetWorktreePath,
      branch,
      baseBranch: repoInfo.mainBranch,
      action: "create",
    }) as { success: boolean; worktreePath: string; changeId?: string; vcs?: string };

    worktreePath = worktreeResult.worktreePath;

    if (worktreeResult?.changeId) {
      forgegraphRevisionId = worktreeResult.changeId;
    }

    // Configure git credential helper so agents can push without token in .git/config
    try {
      const repo = await db.query.repositories.findFirst({
        where: eq(repositories.id, repoInfo.repositoryId),
      });
      if (repo?.gitProviderConnectionId && repo.remoteOwner && repo.remoteName) {
        const conn = await db.query.gitProviderConnections.findFirst({
          where: eq(gitProviderConnections.id, repo.gitProviderConnectionId),
        });
        if (conn?.accessTokenCiphertext && conn.accessTokenIv && conn.accessTokenTag) {
          const token = decryptProviderToken(
            { ciphertext: conn.accessTokenCiphertext, iv: conn.accessTokenIv, tag: conn.accessTokenTag },
            conn.id,
          );
          if (token) {
            // Use GIT_ASKPASS with a temp script instead of embedding token in remote URL.
            // The script is deleted after git config is set, but git caches the credential
            // helper path — it only needs to exist when git actually calls it during push.
            const { writeFileSync, chmodSync, unlinkSync } = await import("node:fs");
            const { execSync } = await import("node:child_process");
            const askpassPath = join(worktreePath, ".git", "askpass.sh");
            writeFileSync(askpassPath, `#!/bin/sh\necho "${token}"\n`, { mode: 0o700 });
            chmodSync(askpassPath, 0o700);

            // Configure the worktree to use the askpass script and set username
            execSync(`git config credential.helper ""`, { cwd: worktreePath, stdio: "ignore" });
            execSync(`git config user.name "Bob Builder"`, { cwd: worktreePath, stdio: "ignore" });
            execSync(`git config user.email "bob@builder.dev"`, { cwd: worktreePath, stdio: "ignore" });

            // Set GIT_ASKPASS at the repo level so child git processes inherit it
            execSync(`git config core.askPass "${askpassPath}"`, { cwd: worktreePath, stdio: "ignore" });

            // Ensure remote URL uses HTTPS with x-access-token username (no password in URL)
            const httpsUrl = `https://x-access-token@github.com/${repo.remoteOwner}/${repo.remoteName}.git`;
            execSync(`git remote set-url origin "${httpsUrl}"`, { cwd: worktreePath, stdio: "ignore" });

            console.log(`[taskExecutor] Configured credential helper for ${branch}`);
          }
        }
      }
    } catch (authErr) {
      console.warn(`[taskExecutor] Failed to configure auth remote:`, authErr);
    }

    // Record the worktree in the database
    const [worktreeRecord] = await db
      .insert(worktrees)
      .values({
        userId,
        repositoryId: repoInfo.repositoryId,
        path: worktreePath,
        branch,
      })
      .returning();
    if (worktreeRecord) {
      worktreeId = worktreeRecord.id;
    }
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";

    // Fall back to checkout in main repo if worktree creation fails
    console.warn(`[taskExecutor] Worktree creation failed, falling back to checkout: ${errorMessage}`);
    try {
      const checkoutResult = await gatewayRequest(userId, "/git/checkout", {
        path: repoInfo.path,
        branch,
        baseBranch: repoInfo.mainBranch,
        create: true,
      }) as { success: boolean; changeId?: string; vcs?: string };

      if (checkoutResult?.changeId) {
        forgegraphRevisionId = checkoutResult.changeId;
      }
    } catch (checkoutError) {
      const checkoutMsg = checkoutError instanceof Error ? checkoutError.message : "Unknown error";
      if (!checkoutMsg.includes("already exists")) {
        const [taskRun] = await db
          .insert(taskRuns)
          .values({
            userId,
            workItemId: task.id,
            workItemIdentifierSnapshot: task.identifier,
            planningWorkspaceId: task.workspaceId,
            planningItemId: task.id,
            planningItemIdentifier: task.identifier,
            repositoryId: repoInfo.repositoryId,
            status: "failed",
            blockedReason: `Failed to create branch: ${checkoutMsg}`,
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
          blockedReason: `Failed to create branch: ${checkoutMsg}`,
        };
      }
    }
  }

  const selectedAgent = options?.agentType ?? "opencode";

  const [session] = await db
    .insert(chatConversations)
    .values({
      userId,
      repositoryId: repoInfo.repositoryId,
      worktreeId,
      workingDirectory: worktreePath,
      agentType: selectedAgent,
      title: `${task.identifier}: ${task.title}`,
      status: "provisioning",
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
      sessionId: insertedSession.id,
      repositoryId: repoInfo.repositoryId,
      worktreeId,
      status: "starting",
      branch,
      forgegraphRevisionId,
    })
    .returning();
  const insertedTaskRun = expectInsertedRow(
    taskRun,
    "Failed to create starting task run",
  );

  const smolAgentProfile =
    selectedAgent === "smol-agent"
      ? buildSmolAgentTaskExecutionProfile({
          sessionId: insertedSession.id,
          taskRunId: insertedTaskRun.id,
          workItemId: task.id,
          workItemIdentifier: task.identifier,
          title: task.title,
          description: task.description,
          branch,
          workingDirectory: worktreePath,
        })
      : null;
  const prompt =
    smolAgentProfile?.initialPrompt ?? buildInitialPrompt(task, options);
  const launchEnv = smolAgentProfile
    ? buildSmolAgentLaunchEnv(smolAgentProfile.env)
    : undefined;

  try {
    await gatewayRequest(userId, "/session/start", {
      sessionId: insertedSession.id,
      workingDirectory: worktreePath,
      agentType: selectedAgent,
      initialPrompt: prompt,
      env: launchEnv,
    });
  } catch (firstError) {
    // Fallback: if preferred agent fails, try claude
    if (selectedAgent !== "claude") {
      console.warn(
        `[taskExecutor] ${selectedAgent} failed, falling back to claude:`,
        firstError instanceof Error ? firstError.message : firstError,
      );
      try {
        await gatewayRequest(userId, "/session/start", {
          sessionId: insertedSession.id,
          workingDirectory: worktreePath,
          agentType: "claude",
          initialPrompt: buildInitialPrompt(task, options),
        });
        // Fallback succeeded — continue normally
      } catch (fallbackError) {
        // Both failed — treat as original error
        const errorMessage =
          fallbackError instanceof Error ? fallbackError.message : "Unknown error";
        await db.update(taskRuns).set({ status: "failed", blockedReason: `Failed to start session: ${errorMessage}` }).where(eq(taskRuns.id, insertedTaskRun.id));
        await db.update(chatConversations).set({ status: "error", lastError: { code: "TASK_START_FAILED", message: errorMessage, timestamp: new Date().toISOString() } }).where(eq(chatConversations.id, insertedSession.id));
        return { taskRunId: insertedTaskRun.id, sessionId: insertedSession.id, worktreeId, branch, status: "failed", blockedReason: `Failed to start session: ${errorMessage}` };
      }
    } else {
      const errorMessage = firstError instanceof Error ? firstError.message : "Unknown error";
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
    },
  }).catch((err: unknown) =>
    console.warn("[taskExecutor] Failed to write run_started lifecycle event:", err),
  );

  // Report to ForgeGraph (fire and forget)
  void reportForgeGraphCreated(db, {
    id: insertedTaskRun.id,
    repositoryId: repoInfo.repositoryId,
    branch,
    forgegraphRevisionId,
    planningItemId: task.id,
    workItemId: task.id,
  });

  return {
    taskRunId: insertedTaskRun.id,
    sessionId: insertedSession.id,
    worktreeId,
    branch,
    status: "running",
  };
}

function buildInitialPrompt(
  task: PlanningTask,
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
  lines.push("6. Commit your changes with a descriptive message");
  lines.push("7. Push your branch to remote: `git push -u origin HEAD`");
  lines.push("");
  lines.push(
    "IMPORTANT: You MUST commit and push your changes before finishing. The branch has been pre-configured with authentication.",
  );
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
