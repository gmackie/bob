import { exec } from "child_process";
import { existsSync, mkdirSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { promisify } from "util";

import { NextRequest, NextResponse } from "next/server";

import type { AgentType } from "@bob/legacy";
import { and, eq, inArray } from "@bob/db";
import { db } from "@bob/db/client";
import {
  agentInstances,
  repositories,
  taskRuns,
  worktrees,
} from "@bob/db/schema";

import { getSession } from "~/auth/server";
import { getPlanningRemoteConfig } from "~/lib/planning/remote-config";
import { getServices } from "~/server/services";

const execAsync = promisify(exec);

interface RouteParams {
  params: Promise<{ projectId: string }>;
}

type StartBody = {
  branchName: string;
  baseBranch?: string;
  agentType?: AgentType;
  taskIdentifier?: string;
  workspaceId?: string;
};

type KanbangerIssueByIdentifier = {
  id: string;
  identifier: string;
  title: string;
  status: string;
  priority: string;
  projectId: string;
};

async function kanbangerQuery<T>(path: string, input?: unknown): Promise<T> {
  const { baseUrl, apiKey } = getPlanningRemoteConfig();

  if (!apiKey) {
    throw new Error("PLANNING_API_KEY not configured");
  }

  const inputObj = { "0": { json: input ?? {} } };
  const qs = new URLSearchParams({
    batch: "1",
    input: JSON.stringify(inputObj),
  });

  const url = `${baseUrl}/api/trpc/${path}?${qs.toString()}`;
  const response = await fetch(url, {
    method: "GET",
    headers: {
      "X-API-Key": apiKey,
    },
    cache: "no-store",
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Planning API error: ${text}`);
  }

  const result = (await response.json()) as Array<{
    result?: { data?: { json?: T } };
    error?: { message?: string };
  }>;
  if (result[0]?.error) {
    throw new Error(result[0].error.message ?? "Planning error");
  }

  return result[0]?.result?.data?.json as T;
}

/**
 * Compute worktree path and ensure it exists on disk via git commands.
 * Returns the filesystem path of the worktree.
 */
async function ensureWorktreeOnDisk(
  repoPath: string,
  userId: string,
  repoName: string,
  branchName: string,
  baseBranch: string | undefined,
): Promise<string> {
  const safeBranch = branchName.replace(/[/\\:*?"<>|]/g, "-");
  const baseDir = join(homedir(), ".bob", "worktrees");
  const worktreePath = join(baseDir, userId, repoName, safeBranch);

  // If it already exists on disk, nothing to do
  if (existsSync(worktreePath)) {
    return worktreePath;
  }

  // Ensure parent directory exists
  const parentDir = join(baseDir, userId, repoName);
  mkdirSync(parentDir, { recursive: true });

  // Detect default base branch if not provided
  if (!baseBranch) {
    try {
      const { stdout } = await execAsync("git rev-parse --abbrev-ref HEAD", {
        cwd: repoPath,
      });
      baseBranch = stdout.trim();
    } catch {
      for (const candidate of ["main", "master"]) {
        try {
          await execAsync(
            `git show-ref --verify --quiet refs/heads/${candidate}`,
            { cwd: repoPath },
          );
          baseBranch = candidate;
          break;
        } catch {
          // try next
        }
      }
      if (!baseBranch) {
        throw new Error(
          "Could not determine default branch (tried HEAD, main, master)",
        );
      }
    }
  }

  // Check if branch already exists
  let branchExists = false;
  try {
    await execAsync(
      `git show-ref --verify --quiet refs/heads/${branchName}`,
      { cwd: repoPath },
    );
    branchExists = true;
  } catch {
    // branch does not exist
  }

  if (branchExists) {
    await execAsync(`git worktree add "${worktreePath}" "${branchName}"`, {
      cwd: repoPath,
    });
  } else {
    await execAsync(
      `git worktree add "${worktreePath}" -b "${branchName}" "${baseBranch}"`,
      { cwd: repoPath },
    );
  }

  return worktreePath;
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  const session = await getSession();
  const requireAuth = process.env.REQUIRE_AUTH === "true";
  if (requireAuth && !session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { projectId } = await params;

  let body: StartBody;
  try {
    body = (await request.json()) as StartBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const branchName = (body.branchName ?? "").trim();
  const baseBranch = body.baseBranch?.trim() || undefined;
  const agentType = body.agentType ?? "claude";
  const taskIdentifier = (body.taskIdentifier ?? "").trim().toUpperCase();
  const workspaceId = (body.workspaceId ?? "").trim();

  if (!branchName) {
    return NextResponse.json(
      { error: "branchName is required" },
      { status: 400 },
    );
  }
  if (taskIdentifier && !workspaceId) {
    return NextResponse.json(
      { error: "workspaceId is required when taskIdentifier is provided" },
      { status: 400 },
    );
  }

  try {
    let task: (KanbangerIssueByIdentifier & { workspaceId: string }) | null =
      null;
    if (taskIdentifier) {
      let issue: KanbangerIssueByIdentifier;
      try {
        issue = await kanbangerQuery<KanbangerIssueByIdentifier>(
          "issue.getByIdentifier",
          {
            identifier: taskIdentifier,
            workspaceId,
          },
        );
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Failed to resolve task";
        const status = message.toLowerCase().includes("not found") ? 404 : 502;
        return NextResponse.json(
          {
            error:
              status === 404
                ? `Task ${taskIdentifier} was not found`
                : `Failed to resolve task ${taskIdentifier}: ${message}`,
          },
          { status },
        );
      }

      if (!issue?.id || !issue?.identifier) {
        return NextResponse.json(
          { error: `Task ${taskIdentifier} was not found` },
          { status: 404 },
        );
      }
      if (issue.projectId !== projectId) {
        return NextResponse.json(
          {
            error: `Task ${issue.identifier} belongs to a different project`,
          },
          { status: 409 },
        );
      }

      const existingRun = await db.query.taskRuns.findFirst({
        where: and(
          eq(taskRuns.userId, session.user.id),
          eq(taskRuns.kanbangerIssueId, issue.id),
          inArray(taskRuns.status, ["starting", "running", "blocked"]),
        ),
        columns: {
          id: true,
          status: true,
        },
      });
      if (existingRun) {
        return NextResponse.json(
          {
            error: `Task ${issue.identifier} already has an active run (${existingRun.status})`,
          },
          { status: 409 },
        );
      }

      task = {
        ...issue,
        workspaceId,
      };
    }

    const mapped = await db.query.repositories.findMany({
      where: and(
        eq(repositories.userId, session.user.id),
        eq(repositories.kanbangerProjectId, projectId),
      ),
      limit: 2,
    });

    if (mapped.length === 0) {
      return NextResponse.json(
        { error: "Project is not mapped to a repository" },
        { status: 409 },
      );
    }
    if (mapped.length > 1) {
      return NextResponse.json(
        { error: "Project has multiple repositories mapped" },
        { status: 409 },
      );
    }

    const repoRow = mapped[0]!;

    // --- Worktree: create on disk + persist to DB ---
    const worktreePath = await ensureWorktreeOnDisk(
      repoRow.path,
      session.user.id,
      repoRow.name,
      branchName,
      baseBranch,
    );

    // Upsert worktree in DB (find existing or insert new)
    let worktreeRow = await db.query.worktrees.findFirst({
      where: and(
        eq(worktrees.userId, session.user.id),
        eq(worktrees.repositoryId, repoRow.id),
        eq(worktrees.branch, branchName),
      ),
    });
    if (!worktreeRow) {
      const [inserted] = await db
        .insert(worktrees)
        .values({
          userId: session.user.id,
          repositoryId: repoRow.id,
          path: worktreePath,
          branch: branchName,
          preferredAgent: agentType,
        })
        .returning();
      worktreeRow = inserted!;
    }

    // --- Register with legacy services for PTY spawning ---
    const { gitService, agentService } = await getServices();

    const existingLegacy = gitService
      .getRepositories(session.user.id)
      .find((r) => r.path === repoRow.path);
    const legacyRepo =
      existingLegacy ??
      (await gitService.addRepository(repoRow.path, session.user.id));

    // Register the worktree in legacy in-memory map so agentService can find it
    const legacyWorktreeId = Buffer.from(worktreePath).toString("base64");
    const existingLegacyWorktree = gitService.getWorktree(
      legacyWorktreeId,
      session.user.id,
    );
    if (!existingLegacyWorktree) {
      // Manually register - set it in the legacy map
      const legacyWorktree = {
        id: legacyWorktreeId,
        userId: session.user.id,
        path: worktreePath,
        branch: branchName,
        repositoryId: legacyRepo.id,
        preferredAgent: agentType,
        instances: [] as any[],
        isMainWorktree: false,
      };
      // Access internal map via the public worktree loading mechanism
      // We need to register it so agentService.startInstance can find it
      (gitService as any).worktrees?.set(legacyWorktreeId, legacyWorktree);
      legacyRepo.worktrees?.push(legacyWorktree);
    }

    // --- Task run (optional) ---
    let taskRun:
      | {
          id: string;
          status: string;
          kanbangerIssueIdentifier: string;
        }
      | null = null;
    if (task) {
      const [createdTaskRun] = await db
        .insert(taskRuns)
        .values({
          userId: session.user.id,
          kanbangerWorkspaceId: task.workspaceId,
          kanbangerIssueId: task.id,
          kanbangerIssueIdentifier: task.identifier,
          repositoryId: repoRow.id,
          worktreeId: worktreeRow.id,
          status: "starting",
          branch: branchName,
        })
        .returning({
          id: taskRuns.id,
          status: taskRuns.status,
          kanbangerIssueIdentifier: taskRuns.kanbangerIssueIdentifier,
        });

      taskRun = createdTaskRun ?? null;
    }

    // --- Start agent instance ---
    try {
      const instance = await agentService.startInstance(
        legacyWorktreeId,
        agentType,
        session.user.id,
      );

      // Persist agent instance to DB
      await db
        .insert(agentInstances)
        .values({
          userId: session.user.id,
          repositoryId: repoRow.id,
          worktreeId: worktreeRow.id,
          agentType,
          status: "running",
          pid: instance.pid ?? null,
        })
        .onConflictDoNothing();

      if (taskRun) {
        const [updatedTaskRun] = await db
          .update(taskRuns)
          .set({ status: "running" })
          .where(eq(taskRuns.id, taskRun.id))
          .returning({
            id: taskRuns.id,
            status: taskRuns.status,
            kanbangerIssueIdentifier: taskRuns.kanbangerIssueIdentifier,
          });
        taskRun = updatedTaskRun ?? taskRun;
      }

      return NextResponse.json(
        {
          repository: {
            id: repoRow.id,
            name: repoRow.name,
            path: repoRow.path,
            kanbangerProjectId: repoRow.kanbangerProjectId,
          },
          taskRun,
          worktree: {
            id: worktreeRow.id,
            path: worktreePath,
            branch: branchName,
          },
          instance: {
            id: instance.id,
            status: instance.status,
            agentType: instance.agentType,
          },
        },
        { status: 201 },
      );
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";

      // Persist failed instance to DB
      await db
        .insert(agentInstances)
        .values({
          userId: session.user.id,
          repositoryId: repoRow.id,
          worktreeId: worktreeRow.id,
          agentType,
          status: "error",
          errorMessage: errorMessage,
        })
        .onConflictDoNothing();

      if (taskRun) {
        await db
          .update(taskRuns)
          .set({
            status: "failed",
            blockedReason: `Failed to start agent instance: ${errorMessage}`,
          })
          .where(eq(taskRuns.id, taskRun.id));
      }
      throw error;
    }
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 },
    );
  }
}
