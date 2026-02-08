import { NextRequest, NextResponse } from "next/server";

import type { AgentType } from "@bob/legacy";
import { and, eq, inArray } from "@bob/db";
import { db } from "@bob/db/client";
import { repositories, taskRuns } from "@bob/db/schema";

import { getSession } from "~/auth/server";
import { getServices } from "~/server/services";

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

const KANBANGER_URL = process.env.KANBANGER_URL ?? "https://tasks.gmac.io";
const KANBANGER_API_KEY = process.env.KANBANGER_API_KEY;

async function kanbangerQuery<T>(path: string, input?: unknown): Promise<T> {
  if (!KANBANGER_API_KEY) {
    throw new Error("KANBANGER_API_KEY not configured");
  }

  const inputObj = { "0": { json: input ?? {} } };
  const qs = new URLSearchParams({
    batch: "1",
    input: JSON.stringify(inputObj),
  });

  const url = `${KANBANGER_URL}/api/trpc/${path}?${qs.toString()}`;
  const response = await fetch(url, {
    method: "GET",
    headers: {
      "X-API-Key": KANBANGER_API_KEY,
    },
    cache: "no-store",
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Kanbanger API error: ${text}`);
  }

  const result = (await response.json()) as Array<{
    result?: { data?: { json?: T } };
    error?: { message?: string };
  }>;
  if (result[0]?.error) {
    throw new Error(result[0].error.message ?? "Kanbanger error");
  }

  return result[0]?.result?.data?.json as T;
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
    let task: (KanbangerIssueByIdentifier & { workspaceId: string }) | null = null;
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

    const { gitService, agentService } = await getServices();

    const existingLegacy = gitService
      .getRepositories(session.user.id)
      .find((r) => r.path === repoRow.path);
    const legacyRepo =
      existingLegacy ??
      (await gitService.addRepository(repoRow.path, session.user.id));

    const worktree = await gitService.createWorktree(
      legacyRepo.id,
      branchName,
      baseBranch,
      agentType,
      session.user.id,
    );

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
          worktreeId: worktree.id,
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

    try {
      const instance = await agentService.startInstance(
        worktree.id,
        agentType,
        session.user.id,
      );

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
          worktree,
          instance,
        },
        { status: 201 },
      );
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
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
