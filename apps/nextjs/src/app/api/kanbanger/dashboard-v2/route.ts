import { NextResponse } from "next/server";

import { and, eq, inArray, isNotNull } from "@bob/db";
import { db } from "@bob/db/client";
import { agentInstances, repositories, taskRuns } from "@bob/db/schema";

import { getSession } from "~/auth/server";

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

type KanbangerWorkspace = {
  id: string;
  name: string;
  slug: string;
};

type KanbangerProjectListItem = {
  project: {
    id: string;
    name: string;
    key: string;
    status?: string;
    color?: string;
  };
};

type KanbangerProjectGet = {
  project: {
    id: string;
    name: string;
    key: string;
    status?: string;
    color?: string;
  };
  inProgressCount: number | string;
};

type KanbangerIssue = {
  id: string;
  identifier: string;
  title: string;
  status: string;
  projectId: string;
  updatedAt?: string;
  completedAt?: string;
};

function toNumber(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

function isWithinLast24Hours(iso: string | undefined): boolean {
  if (!iso) return false;
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return false;
  return Date.now() - ms <= 24 * 60 * 60 * 1000;
}

async function listIssuesByStatus(input: {
  workspaceId: string;
  status: "in_progress" | "in_review" | "done";
  max: number;
}): Promise<KanbangerIssue[]> {
  const out: KanbangerIssue[] = [];
  const limit = 100;

  for (let offset = 0; out.length < input.max; offset += limit) {
    const page = await kanbangerQuery<KanbangerIssue[]>("issue.list", {
      workspaceId: input.workspaceId,
      filter: { status: [input.status] },
      pagination: {
        limit,
        offset,
        sortBy: "updatedAt",
        sortDirection: "desc",
      },
    });

    if (!Array.isArray(page) || page.length === 0) break;
    out.push(...page);
    if (page.length < limit) break;
  }

  return out.slice(0, input.max);
}

async function mapWithConcurrency<T, U>(
  items: T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<U>,
): Promise<U[]> {
  if (items.length === 0) return [];
  const results = new Array<U>(items.length);
  let nextIndex = 0;

  async function worker() {
    while (true) {
      const current = nextIndex;
      nextIndex += 1;
      if (current >= items.length) return;
      results[current] = await mapper(items[current]!, current);
    }
  }

  const workerCount = Math.max(1, Math.min(concurrency, items.length));
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}

export async function GET(request: Request) {
  const session = await getSession();
  const requireAuth = process.env.REQUIRE_AUTH === "true";
  if (requireAuth && !session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const url = new URL(request.url);
    const workspaceIdParam = url.searchParams.get("workspaceId");

    const memberships = await kanbangerQuery<any[]>("workspace.list");
    const workspaces: KanbangerWorkspace[] = (memberships ?? [])
      .map((m) => m?.workspace ?? m)
      .filter(Boolean)
      .map((w) => ({
        id: String(w.id),
        name: String(w.name),
        slug: String(w.slug),
      }));

    const workspace =
      (workspaceIdParam
        ? workspaces.find((w) => w.id === workspaceIdParam)
        : undefined) ?? workspaces[0];

    if (!workspace) {
      return NextResponse.json(
        { error: "No Kanbanger workspaces found" },
        { status: 404 },
      );
    }

    const projectsPromise = kanbangerQuery<KanbangerProjectListItem[]>(
      "project.list",
      { workspaceId: workspace.id },
    );
    const projectGetsPromise = projectsPromise.then((list) =>
      mapWithConcurrency(list ?? [], 8, async (item) =>
        kanbangerQuery<KanbangerProjectGet>("project.get", {
          id: item.project.id,
        }),
      ),
    );
    const inReviewIssuesPromise = listIssuesByStatus({
      workspaceId: workspace.id,
      status: "in_review",
      max: 5000,
    });
    const doneIssuesPromise = listIssuesByStatus({
      workspaceId: workspace.id,
      status: "done",
      max: 5000,
    });
    const mappedReposPromise = session
      ? db.query.repositories.findMany({
          where: and(
            eq(repositories.userId, session.user.id),
            isNotNull(repositories.kanbangerProjectId),
          ),
        })
      : Promise.resolve([]);
    const activeRunsPromise = session
      ? db.query.taskRuns.findMany({
          where: and(
            eq(taskRuns.userId, session.user.id),
            inArray(taskRuns.status, ["starting", "running", "blocked"]),
          ),
          orderBy: (t, { desc }) => [desc(t.updatedAt)],
          limit: 200,
          with: {
            repository: true,
          },
        })
      : Promise.resolve([]);
    const activeInstancesPromise = session
      ? db.query.agentInstances.findMany({
          where: and(
            eq(agentInstances.userId, session.user.id),
            inArray(agentInstances.status, ["starting", "running"]),
          ),
          orderBy: (t, { desc }) => [desc(t.updatedAt)],
          limit: 200,
          with: {
            worktree: true,
            repository: true,
          },
        })
      : Promise.resolve([]);

    const [
      projects,
      projectGets,
      inReviewIssues,
      doneIssues,
      mappedRepos,
      activeRuns,
      activeInstances,
    ] = await Promise.all([
      projectsPromise,
      projectGetsPromise,
      inReviewIssuesPromise,
      doneIssuesPromise,
      mappedReposPromise,
      activeRunsPromise,
      activeInstancesPromise,
    ]);

    const reposByProject = new Map<string, typeof mappedRepos>();
    for (const repo of mappedRepos) {
      if (!repo.kanbangerProjectId) continue;
      const list = reposByProject.get(repo.kanbangerProjectId) ?? [];
      list.push(repo);
      reposByProject.set(repo.kanbangerProjectId, list);
    }

    const inReviewByProject = new Map<string, number>();
    for (const i of inReviewIssues) {
      inReviewByProject.set(
        i.projectId,
        (inReviewByProject.get(i.projectId) ?? 0) + 1,
      );
    }

    const done24ByProject = new Map<string, number>();
    for (const i of doneIssues) {
      const ts = i.completedAt ?? i.updatedAt;
      if (!isWithinLast24Hours(ts)) continue;
      done24ByProject.set(
        i.projectId,
        (done24ByProject.get(i.projectId) ?? 0) + 1,
      );
    }

    const projectRows: Array<{
      project: { id: string; key: string; name: string; color?: string };
      counts: { inProgress: number; inReview: number; done24h: number };
      repository: {
        id: string;
        name: string;
        path: string;
        remoteProvider: string | null;
        remoteUrl: string | null;
      } | null;
      mappingError: string | null;
    }> = [];

    let totalInProgress = 0;
    let totalInReview = 0;
    let totalDone24h = 0;

    for (let index = 0; index < (projects ?? []).length; index += 1) {
      const item = projects[index]!;
      const pg = projectGets[index];
      const inProgress = toNumber(pg?.inProgressCount);
      const inReview = inReviewByProject.get(item.project.id) ?? 0;
      const done24h = done24ByProject.get(item.project.id) ?? 0;

      totalInProgress += inProgress;
      totalInReview += inReview;
      totalDone24h += done24h;

      const repos = reposByProject.get(item.project.id) ?? [];
      const repository =
        repos.length === 1
          ? {
              id: repos[0]!.id,
              name: repos[0]!.name,
              path: repos[0]!.path,
              remoteProvider: repos[0]!.remoteProvider,
              remoteUrl: repos[0]!.remoteUrl,
            }
          : null;

      const mappingError =
        repos.length === 0
          ? "unmapped"
          : repos.length > 1
            ? "multiple_repos_mapped"
            : null;

      projectRows.push({
        project: {
          id: item.project.id,
          key: item.project.key,
          name: item.project.name,
          color: item.project.color,
        },
        counts: { inProgress, inReview, done24h },
        repository,
        mappingError,
      });
    }

    return NextResponse.json({
      workspace,
      generatedAt: new Date().toISOString(),
      totals: {
        inProgress: totalInProgress,
        inReview: totalInReview,
        doneLast24h: totalDone24h,
      },
      projects: projectRows,
      activeRuns: activeRuns.map((r) => ({
        id: r.id,
        kanbangerIssueId: r.kanbangerIssueId,
        kanbangerIssueIdentifier: r.kanbangerIssueIdentifier,
        status: r.status,
        blockedReason: r.blockedReason,
        branch: r.branch,
        updatedAt: r.updatedAt,
        repository: r.repository
          ? {
              id: r.repository.id,
              name: r.repository.name,
              path: r.repository.path,
              kanbangerProjectId: r.repository.kanbangerProjectId,
            }
          : null,
      })),
      activeInstances: activeInstances.map((i) => ({
        id: i.id,
        agentType: i.agentType,
        status: i.status,
        worktreeId: i.worktreeId,
        branch: i.worktree?.branch ?? null,
        worktreePath: i.worktree?.path ?? null,
        updatedAt: i.updatedAt,
        repository: i.repository
          ? {
              id: i.repository.id,
              name: i.repository.name,
              path: i.repository.path,
              kanbangerProjectId: i.repository.kanbangerProjectId,
            }
          : null,
      })),
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 },
    );
  }
}
