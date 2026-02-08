import { NextResponse } from "next/server";

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
    status: string;
    color: string;
  };
  issueCount: number;
  completedCount: number;
};

type KanbangerProjectGet = {
  project: {
    id: string;
    name: string;
    key: string;
    description?: string;
    status: string;
    color: string;
  };
  issueCount: number | string;
  completedCount: number | string;
  inProgressCount: number | string;
  backlogCount: number | string;
};

type KanbangerIssue = {
  id: string;
  identifier: string;
  title: string;
  status: string;
  createdAt?: string;
  updatedAt?: string;
  completedAt?: string;
};

async function listIssuesByStatus(input: {
  workspaceId: string;
  projectId: string;
  status: "in_review" | "done";
  max: number;
}): Promise<KanbangerIssue[]> {
  const out: KanbangerIssue[] = [];
  const limit = 100;

  for (let offset = 0; out.length < input.max; offset += limit) {
    const page = await kanbangerQuery<KanbangerIssue[]>("issue.list", {
      workspaceId: input.workspaceId,
      filter: { projectId: input.projectId, status: [input.status] },
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

function isWithinLast24Hours(iso: string | undefined): boolean {
  if (!iso) return false;
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return false;
  return Date.now() - ms <= 24 * 60 * 60 * 1000;
}

function toNumber(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
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
    const workspaces: KanbangerWorkspace[] = memberships
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

    const list = await kanbangerQuery<KanbangerProjectListItem[]>(
      "project.list",
      {
        workspaceId: workspace.id,
      },
    );

    const projects = [] as Array<{
      project: KanbangerProjectGet["project"];
      issueCount: number;
      completedCount: number;
      inProgressCount: number;
      inReviewCount: number;
      doneLast24hCount: number;
    }>;

    let totalInProgress = 0;
    let totalInReview = 0;
    let totalDoneLast24h = 0;

    for (const item of list ?? []) {
      const pg = await kanbangerQuery<KanbangerProjectGet>("project.get", {
        id: item.project.id,
      });

      const inReviewIssues = await listIssuesByStatus({
        workspaceId: workspace.id,
        projectId: item.project.id,
        status: "in_review",
        max: 2000,
      });

      const doneIssues = await listIssuesByStatus({
        workspaceId: workspace.id,
        projectId: item.project.id,
        status: "done",
        max: 2000,
      });
      const doneLast24hCount = doneIssues.filter((i) =>
        isWithinLast24Hours(i.completedAt ?? i.updatedAt),
      ).length;

      const inReviewCount = inReviewIssues.length;
      projects.push({
        project: pg.project,
        issueCount: toNumber(pg.issueCount),
        completedCount: toNumber(pg.completedCount),
        inProgressCount: toNumber(pg.inProgressCount),
        inReviewCount,
        doneLast24hCount,
      });

      totalInProgress += toNumber(pg.inProgressCount);
      totalInReview += inReviewCount;
      totalDoneLast24h += doneLast24hCount;
    }

    return NextResponse.json({
      workspace,
      generatedAt: new Date().toISOString(),
      totals: {
        inProgress: totalInProgress,
        inReviewOrTesting: totalInReview,
        doneLast24h: totalDoneLast24h,
      },
      projects,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 },
    );
  }
}
