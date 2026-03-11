import { z } from "zod";
import { eq, and, desc, asc, or, like, sql, inArray, isNull, gte, lte } from "drizzle-orm";
import {
  agentSessions,
  agentTaskRuns,
  issues,
  issueLabels,
  issueArtifacts,
  labels,
  users,
  teams,
  projects,
  cycles,
  activities,
  notifications,
  issueSubscribers,
  issueGitLinks,
} from "@linear-clone/db";
import { router, protectedProcedure } from "../trpc";
import { publishIssueEvent, SSE_EVENTS } from "@linear-clone/realtime/sse-server";
import { dispatchWebhook, buildIssuePayload } from "../services/outbound-webhook";
import { createExternalIssue, syncStatusToExternal } from "../services/external-issue-sync";

const issueStatusEnum = z.enum([
  "backlog",
  "todo",
  "in_progress",
  "in_review",
  "done",
  "canceled",
]);

const issuePriorityEnum = z.enum(["no_priority", "urgent", "high", "medium", "low"]);

const issueTypeEnum = z.enum(["issue", "bug", "feature", "epic"]);

const issueFunnelSourceTypeEnum = z.enum([
  "manual",
  "sentry",
  "ticket",
  "forgegraph",
  "api",
]);

const issueFunnelArtifactTypeEnum = z.enum([
  "idea",
  "plan",
  "brd",
  "spec",
  "task",
  "pr",
  "release",
]);

const issueFunnelStageEnum = z.enum([
  "dumped",
  "triaged",
  "planned",
  "designed",
  "ready_for_execution",
  "picked_up",
  "staging_deployed",
  "staging_verified",
  "production_deployed",
]);

const issueFunnelTshirtSizeEnum = z.enum(["xs", "s", "m", "l", "xl", "xxl"]);

const createIssueInput = z.object({
  projectId: z.string().uuid(),
  title: z.string().max(500).optional(),
  description: z.string().max(10000).optional(),
  descriptionHtml: z.string().optional(),
  type: issueTypeEnum.default("issue"),
  status: issueStatusEnum.default("backlog"),
  priority: issuePriorityEnum.default("no_priority"),
  assigneeId: z.string().uuid().optional(),
  teamId: z.string().uuid().optional(),
  cycleId: z.string().uuid().optional(),
  parentId: z.string().uuid().optional(),
  epicId: z.string().uuid().optional(),
  estimate: z.number().int().min(0).max(100).optional(),
  storyPoints: z.number().int().min(0).max(100).optional(),
  dueDate: z.date().optional(),
  funnelSourceType: issueFunnelSourceTypeEnum.default("manual"),
  funnelSourceId: z.string().max(255).optional(),
  funnelSourceUrl: z.string().url().optional(),
  funnelTshirtSize: issueFunnelTshirtSizeEnum.optional(),
  funnelArtifactType: issueFunnelArtifactTypeEnum.default("idea"),
  funnelStage: issueFunnelStageEnum.default("dumped"),
  funnelMetadata: z.record(z.unknown()).optional(),
  labelIds: z.array(z.string().uuid()).optional(),
});

const updateIssueInput = z.object({
  id: z.string().uuid(),
  title: z.string().min(1).max(500).optional(),
  description: z.string().max(10000).nullish(),
  descriptionHtml: z.string().nullish(),
  type: issueTypeEnum.optional(),
  status: issueStatusEnum.optional(),
  priority: issuePriorityEnum.optional(),
  assigneeId: z.string().uuid().nullish(),
  teamId: z.string().uuid().nullish(),
  projectId: z.string().uuid().optional(),
  cycleId: z.string().uuid().nullish(),
  parentId: z.string().uuid().nullish(),
  epicId: z.string().uuid().nullish(),
  estimate: z.number().int().min(0).max(100).nullish(),
  storyPoints: z.number().int().min(0).max(100).nullish(),
  dueDate: z.date().nullish(),
  funnelSourceType: issueFunnelSourceTypeEnum.optional(),
  funnelSourceId: z.string().max(255).optional(),
  funnelSourceUrl: z.string().url().optional(),
  funnelTshirtSize: issueFunnelTshirtSizeEnum.optional(),
  funnelArtifactType: issueFunnelArtifactTypeEnum.optional(),
  funnelStage: issueFunnelStageEnum.optional(),
  funnelMetadata: z.record(z.unknown()).optional(),
  sortOrder: z.number().optional(),
  trashed: z.boolean().optional(),
  snoozedUntil: z.date().nullish(),
});

const issueFilterInput = z.object({
  projectId: z.string().uuid().optional(),
  teamId: z.string().uuid().optional(),
  cycleId: z.string().uuid().optional(),
  assigneeId: z.string().uuid().optional(),
  creatorId: z.string().uuid().optional(),
  epicId: z.string().uuid().nullish(),
  type: z.array(issueTypeEnum).optional(),
  status: z.array(issueStatusEnum).optional(),
  priority: z.array(issuePriorityEnum).optional(),
  funnelSourceType: z.array(issueFunnelSourceTypeEnum).optional(),
  funnelArtifactType: z.array(issueFunnelArtifactTypeEnum).optional(),
  funnelStage: z.array(issueFunnelStageEnum).optional(),
  funnelTshirtSize: z.array(issueFunnelTshirtSizeEnum).optional(),
  labelIds: z.array(z.string().uuid()).optional(),
  parentId: z.string().uuid().nullish(),
  search: z.string().optional(),
  trashed: z.boolean().default(false),
  dueBefore: z.date().optional(),
  dueAfter: z.date().optional(),
});

type BobIssueUpdateField =
  | "title"
  | "description"
  | "priority"
  | "assigneeId"
  | "projectId"
  | "parentId"
  | "epicId";

export interface BobIssueUpdateMetadata {
  changedFields: Array<{
    field: BobIssueUpdateField;
    from: string | null;
    to: string | null;
  }>;
  forceNewRun: boolean;
}

function serializeBobIssueUpdateValue(value: unknown): string | null {
  if (value === undefined || value === null) {
    return null;
  }

  if (typeof value === "string") {
    return value;
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  return JSON.stringify(value);
}

export function buildBobIssueUpdateMetadata(
  currentIssue: typeof issues.$inferSelect,
  nextIssue: Partial<typeof issues.$inferInsert>,
): BobIssueUpdateMetadata | null {
  const changedFields: BobIssueUpdateMetadata["changedFields"] = [];
  const fieldNames: BobIssueUpdateField[] = [
    "title",
    "description",
    "priority",
    "assigneeId",
    "projectId",
    "parentId",
    "epicId",
  ];

  for (const field of fieldNames) {
    if (!(field in nextIssue)) {
      continue;
    }

    const nextValue = nextIssue[field];
    const currentValue = currentIssue[field];

    if (nextValue === currentValue) {
      continue;
    }

    changedFields.push({
      field,
      from: serializeBobIssueUpdateValue(currentValue),
      to: serializeBobIssueUpdateValue(nextValue),
    });
  }

  if (changedFields.length === 0) {
    return null;
  }

  return {
    changedFields,
    forceNewRun: changedFields.some((change) => change.field === "projectId"),
  };
}

const paginationInput = z.object({
  limit: z.number().min(1).max(100).default(50),
  offset: z.number().min(0).default(0),
  sortBy: z.enum(["createdAt", "updatedAt", "priority", "dueDate", "sortOrder", "status"]).default("createdAt"),
  sortDirection: z.enum(["asc", "desc"]).default("desc"),
});

const sortInput = z.object({
  sortBy: z.enum(["createdAt", "updatedAt", "priority", "dueDate", "sortOrder", "status"]).default("createdAt"),
  sortDirection: z.enum(["asc", "desc"]).default("desc"),
});

const releaseCutInput = z.object({
  projectId: z.string().uuid(),
  issueIds: z.array(z.string().uuid()).min(1),
  releaseVersion: z.string().max(80).optional(),
  releaseTitle: z.string().min(1).max(500).optional(),
});

type ReleaseCommitCategory =
  | "feature"
  | "bugfix"
  | "docs"
  | "refactor"
  | "performance"
  | "chore"
  | "test"
  | "ci"
  | "build"
  | "revert"
  | "other";

interface ReleaseCommitEntry {
  issueId: string;
  issueIdentifier: string;
  issueTitle: string;
  message: string;
  externalId: string | null;
  url: string;
  author: string | null;
}

type BobListProjection = {
  hasActiveRun: boolean;
  needsInput: boolean;
  inReview: boolean;
  hasPr: boolean;
  verificationStatus: "passed" | "failed" | "available" | null;
  latestSummary: string | null;
};

export interface ReleaseChangelogAnalysis {
  totalCommits: number;
  totalIssues: number;
  issuesWithCommits: number;
  byCategory: Record<ReleaseCommitCategory, number>;
  topIssues: Array<{ identifier: string; title: string; commitCount: number }>;
}

function classifyCommitCategory(message: string): ReleaseCommitCategory {
  const normalized = (message ?? "").trim().toLowerCase();
  const match = normalized.match(/^([a-z]+)(\([^)]*\))?:\s*/);
  const commitType = match?.[1];

  if (!commitType) return "other";

  if (commitType === "feat" || commitType === "feature") return "feature";
  if (commitType === "fix" || commitType === "bug") return "bugfix";
  if (commitType === "docs") return "docs";
  if (commitType === "refactor") return "refactor";
  if (commitType === "perf" || commitType === "performance") return "performance";
  if (commitType === "chore") return "chore";
  if (commitType === "test") return "test";
  if (commitType === "ci") return "ci";
  if (commitType === "build") return "build";
  if (commitType === "revert") return "revert";

  return "other";
}

function buildReleaseChangelogAnalysis(
  issues: Array<{ id: string; identifier: string; title: string | null }>,
  commitsByIssue: Map<string, ReleaseCommitEntry[]>
): ReleaseChangelogAnalysis {
  const issueCommitCounts = new Map<string, number>();
  const issueTitles = new Map(
    issues.map((issue) => [issue.id, { identifier: issue.identifier, title: issue.title ?? "" }])
  );

  const byCategory: Record<ReleaseCommitCategory, number> = {
    feature: 0,
    bugfix: 0,
    docs: 0,
    refactor: 0,
    performance: 0,
    chore: 0,
    test: 0,
    ci: 0,
    build: 0,
    revert: 0,
    other: 0,
  };

  const allCommits = Array.from(commitsByIssue.values()).flat();
  for (const commit of allCommits) {
    const category = classifyCommitCategory(commit.message);
    byCategory[category] += 1;
    issueCommitCounts.set(commit.issueId, (issueCommitCounts.get(commit.issueId) ?? 0) + 1);
  }

  return {
    totalCommits: allCommits.length,
    totalIssues: issues.length,
    issuesWithCommits: issueCommitCounts.size,
    byCategory,
    topIssues: [...issueCommitCounts.entries()]
      .map(([issueId, commitCount]) => {
        const issue = issueTitles.get(issueId);
        return {
          identifier: issue?.identifier ?? issueId,
          title: issue?.title ?? "",
          commitCount,
        };
      })
      .sort((a, b) => b.commitCount - a.commitCount || a.identifier.localeCompare(b.identifier))
      .slice(0, 10),
  };
}

function deriveVerificationStatus(
  artifacts: Array<{
    artifactType: string;
    title: string | null;
    summary: string | null;
  }>
): BobListProjection["verificationStatus"] {
  const verificationArtifact = artifacts.find((artifact) => artifact.artifactType === "verification");
  if (!verificationArtifact) return null;

  const sourceText = `${verificationArtifact.title ?? ""} ${verificationArtifact.summary ?? ""}`.toLowerCase();
  if (sourceText.includes("fail")) return "failed";
  if (sourceText.includes("pass") || sourceText.includes("verified")) return "passed";
  return "available";
}

async function buildBobListProjection(
  db: { select: (...args: any[]) => any },
  issueRows: Array<{ id: string; status: string }>,
  gitLinksByIssue: Map<string, { prs: number; commits: number; mergedPrs: number }>
): Promise<Map<string, BobListProjection>> {
  const issueIds = issueRows.map((issue) => issue.id);
  if (issueIds.length === 0) {
    return new Map();
  }

  const runs = await db
    .select({
      id: agentTaskRuns.id,
      issueId: agentTaskRuns.issueId,
      sessionId: agentTaskRuns.sessionId,
      status: agentTaskRuns.status,
      latestSummary: agentTaskRuns.latestSummary,
      claimedAt: agentTaskRuns.claimedAt,
    })
    .from(agentTaskRuns)
    .where(and(inArray(agentTaskRuns.issueId, issueIds), eq(agentTaskRuns.executionBackend, "bob")))
    .orderBy(desc(agentTaskRuns.claimedAt));

  const latestRunByIssue = new Map<string, (typeof runs)[number]>();
  for (const run of runs) {
    if (!latestRunByIssue.has(run.issueId)) {
      latestRunByIssue.set(run.issueId, run);
    }
  }

  const sessionIds = Array.from(
    new Set(
      Array.from(latestRunByIssue.values())
        .map((run) => run.sessionId)
        .filter((sessionId): sessionId is string => Boolean(sessionId))
    )
  );

  const sessions: Array<{ id: string; workflowStatus: string | null }> =
    sessionIds.length > 0
      ? await db
          .select({
            id: agentSessions.id,
            workflowStatus: agentSessions.workflowStatus,
          })
          .from(agentSessions)
          .where(inArray(agentSessions.id, sessionIds))
      : [];
  const sessionsById = new Map<string, { id: string; workflowStatus: string | null }>(
    sessions.map((session: { id: string; workflowStatus: string | null }) => [session.id, session])
  );

  const currentArtifacts: Array<{
    issueId: string;
    artifactType: string;
    title: string | null;
    summary: string | null;
  }> = await db
    .select({
      issueId: issueArtifacts.issueId,
      artifactType: issueArtifacts.artifactType,
      title: issueArtifacts.title,
      summary: issueArtifacts.summary,
    })
    .from(issueArtifacts)
    .where(and(inArray(issueArtifacts.issueId, issueIds), eq(issueArtifacts.isCurrent, true)));

  const artifactsByIssue = new Map<
    string,
    Array<{ issueId: string; artifactType: string; title: string | null; summary: string | null }>
  >();
  for (const artifact of currentArtifacts) {
    const existing = artifactsByIssue.get(artifact.issueId) ?? [];
    existing.push(artifact);
    artifactsByIssue.set(artifact.issueId, existing);
  }

  return new Map(
    issueRows.map((issue) => {
      const run = latestRunByIssue.get(issue.id);
      const session = run?.sessionId ? sessionsById.get(run.sessionId) : null;
      const artifacts = artifactsByIssue.get(issue.id) ?? [];
      const hasPr =
        (gitLinksByIssue.get(issue.id)?.prs ?? 0) > 0 ||
        artifacts.some((artifact: { artifactType: string }) => artifact.artifactType === "pr");

      return [
        issue.id,
        {
          hasActiveRun: Boolean(run && ["claimed", "in_progress", "failed_to_start"].includes(run.status)),
          needsInput: session?.workflowStatus === "awaiting_input",
          inReview: issue.status === "in_review",
          hasPr,
          verificationStatus: deriveVerificationStatus(artifacts),
          latestSummary: run?.latestSummary ?? null,
        } satisfies BobListProjection,
      ];
    })
  );
}

function buildReleaseChangelogMarkdown(params: {
  releaseVersion?: string;
  issues: Array<{ identifier: string; title: string | null; id: string }>;
  commitsByIssue: Map<string, ReleaseCommitEntry[]>;
  analysis: ReleaseChangelogAnalysis;
}): string {
  const lines: string[] = [];
  lines.push(`# Release ${params.releaseVersion?.trim() ?? "Draft"}`);
  lines.push("");
  lines.push(`Issues in cut: ${params.analysis.totalIssues}`);
  lines.push(`Commit messages linked: ${params.analysis.totalCommits}`);
  lines.push("");

  lines.push("## Changelog");
  for (const issue of params.issues) {
    const commits = params.commitsByIssue.get(issue.id) ?? [];
    lines.push(`### ${issue.identifier} — ${issue.title ?? "Untitled issue"}`);
    if (commits.length === 0) {
      lines.push("- No linked commit messages found.");
      continue;
    }
    for (const commit of commits) {
      const shortCommit = commit.externalId ? `(${commit.externalId.slice(0, 8)})` : "";
      const commitText = `${commit.message}${shortCommit ? ` ${shortCommit}` : ""}`;
      if (commit.url) {
        lines.push(`- [${commitText}](${commit.url})`);
      } else {
        lines.push(`- ${commitText}`);
      }
    }
  }

  lines.push("");
  lines.push("## Changelog Analysis");
  lines.push(`- Issues with linked commits: ${params.analysis.issuesWithCommits}`);

  Object.entries(params.analysis.byCategory).forEach(([key, count]) => {
    if (count > 0) {
      lines.push(`- ${key}: ${count}`);
    }
  });

  return lines.join("\n");
}

export const issueRouter = router({
  listAll: protectedProcedure
    .input(
      z.object({
        workspaceId: z.string().uuid(),
        filter: issueFilterInput.optional(),
        sort: sortInput.optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      const filter = input.filter;
      const sort = input.sort ?? {
        sortBy: "createdAt" as const,
        sortDirection: "desc" as const,
      };

      const conditions: ReturnType<typeof eq>[] = [eq(issues.trashed, filter?.trashed ?? false)];

      if (filter?.projectId) {
        conditions.push(eq(issues.projectId, filter.projectId));
      }
      if (filter?.teamId) {
        conditions.push(eq(issues.teamId, filter.teamId));
      }
      if (filter?.cycleId) {
        conditions.push(eq(issues.cycleId, filter.cycleId));
      }
      if (filter?.assigneeId) {
        conditions.push(eq(issues.assigneeId, filter.assigneeId));
      }
      if (filter?.creatorId) {
        conditions.push(eq(issues.creatorId, filter.creatorId));
      }
      if (filter?.epicId !== undefined) {
        if (filter.epicId === null) {
          conditions.push(isNull(issues.epicId) as ReturnType<typeof eq>);
        } else {
          conditions.push(eq(issues.epicId, filter.epicId));
        }
      }
      if (filter?.type && filter.type.length > 0) {
        conditions.push(inArray(issues.type, filter.type) as ReturnType<typeof eq>);
      }
      if (filter?.status && filter.status.length > 0) {
        conditions.push(inArray(issues.status, filter.status) as ReturnType<typeof eq>);
      }
      if (filter?.priority && filter.priority.length > 0) {
        conditions.push(inArray(issues.priority, filter.priority) as ReturnType<typeof eq>);
      }
      if (filter?.funnelSourceType && filter.funnelSourceType.length > 0) {
        conditions.push(
          inArray(issues.funnelSourceType, filter.funnelSourceType) as ReturnType<typeof eq>
        );
      }
      if (filter?.funnelArtifactType && filter.funnelArtifactType.length > 0) {
        conditions.push(
          inArray(issues.funnelArtifactType, filter.funnelArtifactType) as ReturnType<typeof eq>
        );
      }
      if (filter?.funnelStage && filter.funnelStage.length > 0) {
        conditions.push(inArray(issues.funnelStage, filter.funnelStage) as ReturnType<typeof eq>);
      }
      if (filter?.funnelTshirtSize && filter.funnelTshirtSize.length > 0) {
        conditions.push(
          inArray(issues.funnelTshirtSize, filter.funnelTshirtSize) as ReturnType<typeof eq>
        );
      }
      if (filter?.parentId !== undefined) {
        if (filter.parentId === null) {
          conditions.push(isNull(issues.parentId) as ReturnType<typeof eq>);
        } else {
          conditions.push(eq(issues.parentId, filter.parentId));
        }
      }
      if (filter?.dueBefore) {
        conditions.push(lte(issues.dueDate, filter.dueBefore) as ReturnType<typeof eq>);
      }
      if (filter?.dueAfter) {
        conditions.push(gte(issues.dueDate, filter.dueAfter) as ReturnType<typeof eq>);
      }
      if (filter?.search) {
        conditions.push(
          or(like(issues.title, `%${filter.search}%`), like(issues.identifier, `%${filter.search}%`)) as ReturnType<
            typeof eq
          >
        );
      }

      const baseQuery = ctx.db
        .select({
          issue: issues,
          project: {
            id: projects.id,
            name: projects.name,
            key: projects.key,
            color: projects.color,
            icon: projects.icon,
          },
          team: {
            id: teams.id,
            name: teams.name,
            key: teams.key,
            color: teams.color,
          },
          assignee: {
            id: users.id,
            name: users.name,
            email: users.email,
            avatarUrl: users.avatarUrl,
          },
        })
        .from(issues)
        .innerJoin(projects, eq(issues.projectId, projects.id))
        .leftJoin(teams, eq(issues.teamId, teams.id))
        .leftJoin(users, eq(issues.assigneeId, users.id))
        .where(and(eq(projects.workspaceId, input.workspaceId), ...conditions));

      const sortColumn = {
        createdAt: issues.createdAt,
        updatedAt: issues.updatedAt,
        priority: issues.priority,
        dueDate: issues.dueDate,
        sortOrder: issues.sortOrder,
        status: issues.status,
      }[sort.sortBy];

      const sortFn = sort.sortDirection === "asc" ? asc : desc;

      const result = await baseQuery.orderBy(sortFn(sortColumn));

      const issueIds = result.map((r) => r.issue.id);
      const issueLabelsResult =
        issueIds.length > 0
          ? await ctx.db
              .select({
                issueId: issueLabels.issueId,
                label: labels,
              })
              .from(issueLabels)
              .innerJoin(labels, eq(issueLabels.labelId, labels.id))
              .where(inArray(issueLabels.issueId, issueIds))
          : [];

      const labelsByIssue = new Map<string, (typeof labels.$inferSelect)[]>();
      for (const il of issueLabelsResult) {
        const existing = labelsByIssue.get(il.issueId) ?? [];
        existing.push(il.label);
        labelsByIssue.set(il.issueId, existing);
      }

      const gitLinksResult =
        issueIds.length > 0
          ? await ctx.db
              .select({
                issueId: issueGitLinks.issueId,
                type: issueGitLinks.type,
                state: issueGitLinks.state,
              })
              .from(issueGitLinks)
              .where(inArray(issueGitLinks.issueId, issueIds))
          : [];

      const gitLinksByIssue = new Map<string, { prs: number; commits: number; mergedPrs: number }>();
      for (const gl of gitLinksResult) {
        const existing = gitLinksByIssue.get(gl.issueId) ?? { prs: 0, commits: 0, mergedPrs: 0 };
        if (gl.type === "pull_request") {
          existing.prs++;
          if (gl.state === "merged") existing.mergedPrs++;
        } else if (gl.type === "commit") {
          existing.commits++;
        }
        gitLinksByIssue.set(gl.issueId, existing);
      }

      const bobViewByIssue = await buildBobListProjection(
        ctx.db,
        result.map((row) => ({ id: row.issue.id, status: row.issue.status })),
        gitLinksByIssue
      );

      return result.map((r) => ({
        ...r.issue,
        project: r.project,
        team: r.team,
        assignee: r.assignee,
        labels: labelsByIssue.get(r.issue.id) ?? [],
        gitLinks: gitLinksByIssue.get(r.issue.id) ?? { prs: 0, commits: 0, mergedPrs: 0 },
        bobView: bobViewByIssue.get(r.issue.id) ?? null,
      }));
    }),

  list: protectedProcedure
    .input(
      z.object({
        workspaceId: z.string().uuid(),
        filter: issueFilterInput.optional(),
        pagination: paginationInput.optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      const filter = input.filter;
      const pagination = input.pagination ?? {
        limit: 50,
        offset: 0,
        sortBy: "createdAt" as const,
        sortDirection: "desc" as const,
      };

      const conditions: ReturnType<typeof eq>[] = [eq(issues.trashed, filter?.trashed ?? false)];

      if (filter?.projectId) {
        conditions.push(eq(issues.projectId, filter.projectId));
      }
      if (filter?.teamId) {
        conditions.push(eq(issues.teamId, filter.teamId));
      }
      if (filter?.cycleId) {
        conditions.push(eq(issues.cycleId, filter.cycleId));
      }
      if (filter?.assigneeId) {
        conditions.push(eq(issues.assigneeId, filter.assigneeId));
      }
      if (filter?.creatorId) {
        conditions.push(eq(issues.creatorId, filter.creatorId));
      }
      if (filter?.epicId !== undefined) {
        if (filter.epicId === null) {
          conditions.push(isNull(issues.epicId) as ReturnType<typeof eq>);
        } else {
          conditions.push(eq(issues.epicId, filter.epicId));
        }
      }
      if (filter?.type && filter.type.length > 0) {
        conditions.push(inArray(issues.type, filter.type) as ReturnType<typeof eq>);
      }
      if (filter?.status && filter.status.length > 0) {
        conditions.push(inArray(issues.status, filter.status) as ReturnType<typeof eq>);
      }
      if (filter?.priority && filter.priority.length > 0) {
        conditions.push(inArray(issues.priority, filter.priority) as ReturnType<typeof eq>);
      }
      if (filter?.funnelSourceType && filter.funnelSourceType.length > 0) {
        conditions.push(
          inArray(issues.funnelSourceType, filter.funnelSourceType) as ReturnType<typeof eq>
        );
      }
      if (filter?.funnelArtifactType && filter.funnelArtifactType.length > 0) {
        conditions.push(
          inArray(issues.funnelArtifactType, filter.funnelArtifactType) as ReturnType<typeof eq>
        );
      }
      if (filter?.funnelStage && filter.funnelStage.length > 0) {
        conditions.push(inArray(issues.funnelStage, filter.funnelStage) as ReturnType<typeof eq>);
      }
      if (filter?.funnelTshirtSize && filter.funnelTshirtSize.length > 0) {
        conditions.push(
          inArray(issues.funnelTshirtSize, filter.funnelTshirtSize) as ReturnType<typeof eq>
        );
      }
      if (filter?.parentId !== undefined) {
        if (filter.parentId === null) {
          conditions.push(isNull(issues.parentId) as ReturnType<typeof eq>);
        } else {
          conditions.push(eq(issues.parentId, filter.parentId));
        }
      }
      if (filter?.dueBefore) {
        conditions.push(lte(issues.dueDate, filter.dueBefore) as ReturnType<typeof eq>);
      }
      if (filter?.dueAfter) {
        conditions.push(gte(issues.dueDate, filter.dueAfter) as ReturnType<typeof eq>);
      }
      if (filter?.search) {
        conditions.push(
          or(like(issues.title, `%${filter.search}%`), like(issues.identifier, `%${filter.search}%`)) as ReturnType<
            typeof eq
          >
        );
      }

      const baseQuery = ctx.db
        .select({
          issue: issues,
          project: {
            id: projects.id,
            name: projects.name,
            key: projects.key,
            color: projects.color,
            icon: projects.icon,
          },
          team: {
            id: teams.id,
            name: teams.name,
            key: teams.key,
            color: teams.color,
          },
          assignee: {
            id: users.id,
            name: users.name,
            email: users.email,
            avatarUrl: users.avatarUrl,
          },
        })
        .from(issues)
        .innerJoin(projects, eq(issues.projectId, projects.id))
        .leftJoin(teams, eq(issues.teamId, teams.id))
        .leftJoin(users, eq(issues.assigneeId, users.id))
        .where(and(eq(projects.workspaceId, input.workspaceId), ...conditions));

      const sortColumn = {
        createdAt: issues.createdAt,
        updatedAt: issues.updatedAt,
        priority: issues.priority,
        dueDate: issues.dueDate,
        sortOrder: issues.sortOrder,
        status: issues.status,
      }[pagination.sortBy];

      const sortFn = pagination.sortDirection === "asc" ? asc : desc;

      const result = await baseQuery.orderBy(sortFn(sortColumn)).limit(pagination.limit).offset(pagination.offset);

      const issueIds = result.map((r) => r.issue.id);
      const issueLabelsResult =
        issueIds.length > 0
          ? await ctx.db
              .select({
                issueId: issueLabels.issueId,
                label: labels,
              })
              .from(issueLabels)
              .innerJoin(labels, eq(issueLabels.labelId, labels.id))
              .where(inArray(issueLabels.issueId, issueIds))
          : [];

      const labelsByIssue = new Map<string, (typeof labels.$inferSelect)[]>();
      for (const il of issueLabelsResult) {
        const existing = labelsByIssue.get(il.issueId) ?? [];
        existing.push(il.label);
        labelsByIssue.set(il.issueId, existing);
      }

      const gitLinksResult =
        issueIds.length > 0
          ? await ctx.db
              .select({
                issueId: issueGitLinks.issueId,
                type: issueGitLinks.type,
                state: issueGitLinks.state,
              })
              .from(issueGitLinks)
              .where(inArray(issueGitLinks.issueId, issueIds))
          : [];

      const gitLinksByIssue = new Map<string, { prs: number; commits: number; mergedPrs: number }>();
      for (const gl of gitLinksResult) {
        const existing = gitLinksByIssue.get(gl.issueId) ?? { prs: 0, commits: 0, mergedPrs: 0 };
        if (gl.type === "pull_request") {
          existing.prs++;
          if (gl.state === "merged") existing.mergedPrs++;
        } else if (gl.type === "commit") {
          existing.commits++;
        }
        gitLinksByIssue.set(gl.issueId, existing);
      }

      const bobViewByIssue = await buildBobListProjection(
        ctx.db,
        result.map((row) => ({ id: row.issue.id, status: row.issue.status })),
        gitLinksByIssue
      );

      return result.map((r) => ({
        ...r.issue,
        project: r.project,
        team: r.team,
        assignee: r.assignee,
        labels: labelsByIssue.get(r.issue.id) ?? [],
        gitLinks: gitLinksByIssue.get(r.issue.id) ?? { prs: 0, commits: 0, mergedPrs: 0 },
        bobView: bobViewByIssue.get(r.issue.id) ?? null,
      }));
    }),

  listByStatus: protectedProcedure
    .input(z.object({ workspaceId: z.string().uuid(), projectId: z.string().uuid().optional() }))
    .query(async ({ ctx, input }) => {
      const conditions = [eq(issues.trashed, false), isNull(issues.parentId)];

      if (input.projectId) {
        conditions.push(eq(issues.projectId, input.projectId) as ReturnType<typeof eq>);
      }

      const result = await ctx.db
        .select({
          issue: issues,
          project: {
            id: projects.id,
            name: projects.name,
            key: projects.key,
            color: projects.color,
          },
          assignee: {
            id: users.id,
            name: users.name,
            avatarUrl: users.avatarUrl,
          },
        })
        .from(issues)
        .innerJoin(projects, eq(issues.projectId, projects.id))
        .leftJoin(users, eq(issues.assigneeId, users.id))
        .where(and(eq(projects.workspaceId, input.workspaceId), ...conditions))
        .orderBy(issues.sortOrder, desc(issues.updatedAt));

      const grouped = {
        backlog: [] as typeof result,
        todo: [] as typeof result,
        in_progress: [] as typeof result,
        in_review: [] as typeof result,
        done: [] as typeof result,
        canceled: [] as typeof result,
      };

      for (const item of result) {
        const status = item.issue.status as keyof typeof grouped;
        if (grouped[status]) {
          grouped[status].push(item);
        }
      }

      return grouped;
    }),

  get: protectedProcedure.input(z.object({ id: z.string().uuid() })).query(async ({ ctx, input }) => {
    const [result] = await ctx.db
      .select({
        issue: issues,
        project: {
          id: projects.id,
          name: projects.name,
          key: projects.key,
          color: projects.color,
          icon: projects.icon,
          workspaceId: projects.workspaceId,
          repositoryUrl: projects.repositoryUrl,
          repositoryProvider: projects.repositoryProvider,
        },
        team: {
          id: teams.id,
          name: teams.name,
          key: teams.key,
          color: teams.color,
        },
        assignee: {
          id: users.id,
          name: users.name,
          email: users.email,
          avatarUrl: users.avatarUrl,
        },
        cycle: {
          id: cycles.id,
          name: cycles.name,
          number: cycles.number,
          status: cycles.status,
        },
      })
      .from(issues)
      .innerJoin(projects, eq(issues.projectId, projects.id))
      .leftJoin(teams, eq(issues.teamId, teams.id))
      .leftJoin(users, eq(issues.assigneeId, users.id))
      .leftJoin(cycles, eq(issues.cycleId, cycles.id))
      .where(eq(issues.id, input.id))
      .limit(1);

    if (!result) return null;

    const issueLabelsResult = await ctx.db
      .select({ label: labels })
      .from(issueLabels)
      .innerJoin(labels, eq(issueLabels.labelId, labels.id))
      .where(eq(issueLabels.issueId, input.id));

    const [creator] = await ctx.db
      .select({
        id: users.id,
        name: users.name,
        email: users.email,
        avatarUrl: users.avatarUrl,
      })
      .from(users)
      .where(eq(users.id, result.issue.creatorId))
      .limit(1);

    const [subIssuesCount] = await ctx.db
      .select({ count: sql<number>`count(*)` })
      .from(issues)
      .where(eq(issues.parentId, input.id));

    let parent = null;
    if (result.issue.parentId) {
      const [parentResult] = await ctx.db
        .select({
          id: issues.id,
          identifier: issues.identifier,
          title: issues.title,
          status: issues.status,
        })
        .from(issues)
        .where(eq(issues.id, result.issue.parentId))
        .limit(1);
      parent = parentResult ?? null;
    }

    let epic = null;
    if (result.issue.epicId) {
      const [epicResult] = await ctx.db
        .select({
          id: issues.id,
          identifier: issues.identifier,
          title: issues.title,
          status: issues.status,
        })
        .from(issues)
        .where(eq(issues.id, result.issue.epicId))
        .limit(1);
      epic = epicResult ?? null;
    }

    const gitLinksData = await ctx.db
      .select()
      .from(issueGitLinks)
      .where(eq(issueGitLinks.issueId, input.id))
      .orderBy(desc(issueGitLinks.createdAt));

    const activityData = await ctx.db
      .select({
        activity: activities,
        user: {
          id: users.id,
          name: users.name,
          avatarUrl: users.avatarUrl,
        },
      })
      .from(activities)
      .leftJoin(users, eq(activities.userId, users.id))
      .where(eq(activities.issueId, input.id))
      .orderBy(desc(activities.createdAt))
      .limit(50);

    const [latestBobRun] = await ctx.db
      .select()
      .from(agentTaskRuns)
      .where(and(eq(agentTaskRuns.issueId, input.id), eq(agentTaskRuns.executionBackend, "bob")))
      .orderBy(desc(agentTaskRuns.claimedAt))
      .limit(1);

    const currentArtifacts = await ctx.db
      .select()
      .from(issueArtifacts)
      .where(eq(issueArtifacts.issueId, input.id));

    let bobSession = null;
    if (latestBobRun?.sessionId) {
      const [session] = await ctx.db
        .select()
        .from(agentSessions)
        .where(eq(agentSessions.id, latestBobRun.sessionId))
        .limit(1);
      bobSession = session ?? null;
    }

    return {
      ...result.issue,
      project: result.project,
      team: result.team,
      assignee: result.assignee,
      cycle: result.cycle,
      creator,
      parent,
      epic,
      labels: issueLabelsResult.map((il) => il.label),
      subIssuesCount: subIssuesCount?.count ?? 0,
      gitLinks: gitLinksData,
      bobRun: latestBobRun
        ? {
            ...latestBobRun,
            session: bobSession,
          }
        : null,
      currentArtifacts: currentArtifacts.filter((artifact) => artifact.isCurrent),
      activities: activityData.map((a) => ({
        ...a.activity,
        user: a.user,
      })),
    };
  }),

  getByIdentifier: protectedProcedure
    .input(z.object({ identifier: z.string(), workspaceId: z.string().uuid().optional() }))
    .query(async ({ ctx, input }) => {
      const conditions = [eq(issues.identifier, input.identifier)];

      if (input.workspaceId) {
        conditions.push(eq(projects.workspaceId, input.workspaceId) as ReturnType<typeof eq>);
      }

      const [result] = await ctx.db
        .select({ issue: issues })
        .from(issues)
        .innerJoin(projects, eq(issues.projectId, projects.id))
        .where(and(...conditions))
        .limit(1);

      return result?.issue ?? null;
    }),

  create: protectedProcedure.input(createIssueInput).mutation(async ({ ctx, input }) => {
    const { labelIds, ...issueData } = input;

    const user = ctx.user;
    if (!user) {
      throw new Error("User not found");
    }

    const [project] = await ctx.db.select().from(projects).where(eq(projects.id, input.projectId)).limit(1);

    if (!project) {
      throw new Error("Project not found");
    }

    const [updatedProject] = await ctx.db
      .update(projects)
      .set({
        issueCount: sql`${projects.issueCount} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(projects.id, input.projectId))
      .returning();

    if (!updatedProject) {
      throw new Error("Failed to update project issue count");
    }

    const issueNumber = updatedProject.issueCount;
    const identifier = `${project.key}-${issueNumber}`;

    if (issueData.type === "epic" && (issueData.parentId || issueData.epicId)) {
      throw new Error("Epics cannot have a parent or be assigned to an epic");
    }

    const fallbackTitle =
      issueData.title?.trim() || issueData.description?.trim().slice(0, 120) || "Untitled idea";

    const [issue] = await ctx.db
      .insert(issues)
      .values({
        ...issueData,
        title: fallbackTitle,
        creatorId: user.id,
        number: issueNumber,
        identifier,
        startedAt: issueData.status === "in_progress" ? new Date() : undefined,
        completedAt: issueData.status === "done" ? new Date() : undefined,
        canceledAt: issueData.status === "canceled" ? new Date() : undefined,
      })
      .returning();

    if (!issue) {
      throw new Error("Failed to create issue");
    }

    if (labelIds && labelIds.length > 0) {
      await ctx.db.insert(issueLabels).values(
        labelIds.map((labelId) => ({
          issueId: issue.id,
          labelId,
        }))
      );
    }

    await ctx.db.insert(activities).values({
      issueId: issue.id,
      userId: user.id,
      type: "created",
      metadata: { type: issueData.type },
    });

    await ctx.db.insert(issueSubscribers).values({
      issueId: issue.id,
      userId: user.id,
    });

    publishIssueEvent(
      SSE_EVENTS.ISSUE_CREATED,
      project.workspaceId,
      {
        id: issue.id,
        projectId: issue.projectId,
        title: issue.title,
        status: issue.status,
        identifier: issue.identifier,
      },
      issue.projectId,
      issue.id
    ).catch(() => {});

    dispatchWebhook(
      ctx.db,
      project.workspaceId,
      issue.projectId,
      "issue.created",
      buildIssuePayload(issue)
    ).catch(() => {});

    createExternalIssue(ctx.db, issue.projectId, {
      id: issue.id,
      identifier: issue.identifier,
      title: issue.title,
      description: issue.description,
      status: issue.status,
      priority: issue.priority,
    }, user.id).catch(() => {});

    return issue;
  }),

  createReleaseCut: protectedProcedure.input(releaseCutInput).mutation(async ({ ctx, input }) => {
    const user = ctx.user;
    if (!user) {
      throw new Error("User not found");
    }

    const uniqueIssueIds = Array.from(new Set(input.issueIds));

    const [project] = await ctx.db
      .select()
      .from(projects)
      .where(eq(projects.id, input.projectId))
      .limit(1);

    if (!project) {
      throw new Error("Project not found");
    }

    const [updatedProject] = await ctx.db
      .update(projects)
      .set({
        issueCount: sql`${projects.issueCount} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(projects.id, input.projectId))
      .returning();

    if (!updatedProject) {
      throw new Error("Failed to update project issue count");
    }

    const [issueRows, commitRows] = await Promise.all([
      ctx.db
        .select({
          id: issues.id,
          identifier: issues.identifier,
          title: issues.title,
          status: issues.status,
        })
        .from(issues)
        .where(and(eq(issues.projectId, input.projectId), inArray(issues.id, uniqueIssueIds)))
        .orderBy(asc(issues.identifier)),
      ctx.db
        .select({
          issueId: issueGitLinks.issueId,
          title: issueGitLinks.title,
          url: issueGitLinks.url,
          externalId: issueGitLinks.externalId,
          author: issueGitLinks.author,
        })
        .from(issueGitLinks)
        .where(and(inArray(issueGitLinks.issueId, uniqueIssueIds), eq(issueGitLinks.type, "commit")))
        .orderBy(desc(issueGitLinks.createdAt)),
    ]);

    if (issueRows.length !== uniqueIssueIds.length) {
      throw new Error("One or more issue IDs were not found in the selected project");
    }

    const commitsByIssue = new Map<string, ReleaseCommitEntry[]>();
    for (const issue of issueRows) {
      commitsByIssue.set(issue.id, []);
    }

    const seenCommitKeys = new Set<string>();
    for (const commit of commitRows) {
      const key = `${commit.issueId}|${commit.externalId ?? commit.url}`;
      if (!commit.issueId || seenCommitKeys.has(key)) {
        continue;
      }
      seenCommitKeys.add(key);

      const issue = issueRows.find((i) => i.id === commit.issueId);
      if (!issue) {
        continue;
      }

      commitsByIssue.set(commit.issueId, [
        ...(commitsByIssue.get(commit.issueId) ?? []),
        {
          issueId: commit.issueId,
          issueIdentifier: issue.identifier,
          issueTitle: issue.title,
          message: commit.title ?? "Unnamed commit",
          externalId: commit.externalId ?? null,
          url: commit.url,
          author: commit.author ?? null,
        },
      ]);
    }

    const analysis = buildReleaseChangelogAnalysis(issueRows, commitsByIssue);
    const changelogMarkdown = buildReleaseChangelogMarkdown({
      releaseVersion: input.releaseVersion?.trim(),
      issues: issueRows,
      commitsByIssue,
      analysis,
    });

    const issueNumber = updatedProject.issueCount;
    const identifier = `${project.key}-${issueNumber}`;
    const releaseTitle = input.releaseTitle?.trim() ||
      `Release ${input.releaseVersion ?? issueNumber.toString()}`;

    const [releaseIssue] = await ctx.db
      .insert(issues)
      .values({
        projectId: project.id,
        creatorId: user.id,
        number: issueNumber,
        identifier,
        title: releaseTitle,
        description: changelogMarkdown,
        type: "issue",
        status: "backlog",
        priority: "no_priority",
        funnelSourceType: "api",
        funnelArtifactType: "release",
        funnelStage: "picked_up",
        funnelMetadata: {
          releaseCut: {
            releaseVersion: input.releaseVersion ?? null,
            sourceIssueIds: uniqueIssueIds,
            sourceIssueIdentifiers: issueRows.map((issue) => issue.identifier),
            changelog: analysis,
          },
        },
      })
      .returning();

    if (!releaseIssue) {
      throw new Error("Failed to create release issue");
    }

    await ctx.db.insert(issueSubscribers).values({
      issueId: releaseIssue.id,
      userId: user.id,
    });

    await ctx.db.insert(activities).values({
      issueId: releaseIssue.id,
      userId: user.id,
      type: "created",
      metadata: { releaseVersion: input.releaseVersion ?? null },
    });

    publishIssueEvent(
      SSE_EVENTS.ISSUE_CREATED,
      project.workspaceId,
      {
        id: releaseIssue.id,
        projectId: releaseIssue.projectId,
        status: releaseIssue.status,
        title: releaseIssue.title,
        identifier: releaseIssue.identifier,
      },
      releaseIssue.projectId,
      releaseIssue.id
    ).catch(() => {});

    dispatchWebhook(
      ctx.db,
      project.workspaceId,
      releaseIssue.projectId,
      "issue.created",
      buildIssuePayload(releaseIssue),
      { field: "artifactType", from: null, to: "release" }
    ).catch(() => {});

    return {
      releaseIssue,
      analysis,
      changelogMarkdown,
      sourceIssueIds: uniqueIssueIds,
      sourceIssueIdentifiers: issueRows.map((issue) => issue.identifier),
    };
  }),

  update: protectedProcedure.input(updateIssueInput).mutation(async ({ ctx, input }) => {
    const { id, ...data } = input;

    const user = ctx.user;

    const [currentIssue] = await ctx.db.select().from(issues).where(eq(issues.id, id)).limit(1);

    if (!currentIssue) {
      throw new Error("Issue not found");
    }

    if (data.type === "epic" && (data.parentId || data.epicId)) {
      throw new Error("Epics cannot have a parent or be assigned to an epic");
    }

    const hasFunnelStageChange =
      data.funnelStage !== undefined && data.funnelStage !== currentIssue.funnelStage;
    const updateData: Record<string, unknown> = { ...data, updatedAt: new Date() };
    const bobIssueUpdate = buildBobIssueUpdateMetadata(
      currentIssue,
      data as Partial<typeof issues.$inferInsert>,
    );

    if (data.status) {
      if (data.status === "in_progress" && currentIssue.status !== "in_progress") {
        updateData.startedAt = currentIssue.startedAt ?? new Date();
      }
      if (data.status === "done" && currentIssue.status !== "done") {
        updateData.completedAt = new Date();
      }
      if (data.status === "canceled" && currentIssue.status !== "canceled") {
        updateData.canceledAt = new Date();
      }
      if (
        ["backlog", "todo", "in_progress", "in_review"].includes(data.status) &&
        ["done", "canceled"].includes(currentIssue.status)
      ) {
        updateData.completedAt = null;
        updateData.canceledAt = null;
      }
    }

    const [issue] = await ctx.db.update(issues).set(updateData).where(eq(issues.id, id)).returning();

    if (data.status && data.status !== currentIssue.status && user) {
      await ctx.db.insert(activities).values({
        issueId: id,
        userId: user.id,
        type: "status_changed",
        fromValue: currentIssue.status,
        toValue: data.status,
      });
    }

    if (hasFunnelStageChange && user) {
      await ctx.db.insert(activities).values({
        issueId: id,
        userId: user.id,
        type: "funnel_stage_changed",
        fromValue: currentIssue.funnelStage,
        toValue: data.funnelStage ?? currentIssue.funnelStage,
      });
    }

    if (data.priority && data.priority !== currentIssue.priority && user) {
      await ctx.db.insert(activities).values({
        issueId: id,
        userId: user.id,
        type: "priority_changed",
        fromValue: currentIssue.priority,
        toValue: data.priority,
      });
    }

    if (data.assigneeId !== undefined && data.assigneeId !== currentIssue.assigneeId && user) {
      await ctx.db.insert(activities).values({
        issueId: id,
        userId: user.id,
        type: "assignee_changed",
        fromValue: currentIssue.assigneeId ?? undefined,
        toValue: data.assigneeId ?? undefined,
      });
    }

    if (data.epicId !== undefined && data.epicId !== currentIssue.epicId && user) {
      await ctx.db.insert(activities).values({
        issueId: id,
        userId: user.id,
        type: "project_changed",
        fromValue: currentIssue.epicId ?? undefined,
        toValue: data.epicId ?? undefined,
        metadata: { field: "epic" },
      });
    }

    if (issue) {
      const [proj] = await ctx.db.select({ workspaceId: projects.workspaceId }).from(projects).where(eq(projects.id, issue.projectId)).limit(1);
      if (proj) {
        const bobReassignment =
          data.assigneeId !== undefined && data.assigneeId !== currentIssue.assigneeId;
        const [activeBobRun] =
          bobIssueUpdate || bobReassignment
            ? await ctx.db
                .select({
                  id: agentTaskRuns.id,
                  agentId: agentTaskRuns.agentId,
                  sessionId: agentTaskRuns.sessionId,
                })
                .from(agentTaskRuns)
                .where(
                  and(
                    eq(agentTaskRuns.issueId, issue.id),
                    eq(agentTaskRuns.executionBackend, "bob"),
                    inArray(agentTaskRuns.status, ["claimed", "in_progress"]),
                  ),
                )
                .limit(1)
            : [null];

        if (bobReassignment && activeBobRun) {
          const handoffReason = "Issue reassigned away from Bob";

          await ctx.db
            .update(agentTaskRuns)
            .set({
              status: "handed_off",
              completedAt: new Date(),
              handedOffTo: data.assigneeId ?? null,
              handoffReason,
            })
            .where(eq(agentTaskRuns.id, activeBobRun.id));

          if (activeBobRun.sessionId) {
            await ctx.db
              .update(agentSessions)
              .set({
                status: "idle",
                currentIssueId: null,
              })
              .where(eq(agentSessions.id, activeBobRun.sessionId));
          }

          await ctx.db.insert(activities).values({
            issueId: issue.id,
            userId: activeBobRun.agentId,
            type: "agent_handed_off",
            metadata: {
              taskRunId: activeBobRun.id,
              handedOffTo: data.assigneeId ?? null,
              reason: handoffReason,
            },
          });

          if (data.assigneeId) {
            await ctx.db.insert(notifications).values({
              userId: data.assigneeId,
              type: "issue_assigned",
              issueId: issue.id,
              actorId: activeBobRun.agentId,
              title: "Bob handed off task to you",
              body: handoffReason,
            });
          }
        }

        publishIssueEvent(
          SSE_EVENTS.ISSUE_UPDATED,
          proj.workspaceId,
          {
            id: issue.id,
            projectId: issue.projectId,
            status: issue.status,
            title: issue.title,
            assigneeId: issue.assigneeId,
            kanbanRank: issue.kanbanRank,
          },
          issue.projectId,
          issue.id
        ).catch(() => {});

        if (data.status && data.status !== currentIssue.status) {
          dispatchWebhook(
            ctx.db,
            proj.workspaceId,
            issue.projectId,
            "issue.status_changed",
            buildIssuePayload(issue),
            { field: "status", from: currentIssue.status, to: data.status }
          ).catch(() => {});

          if (data.status === "done" && currentIssue.status !== "done") {
            dispatchWebhook(
              ctx.db,
              proj.workspaceId,
              issue.projectId,
              "issue.completed",
              buildIssuePayload(issue),
              { field: "status", from: currentIssue.status, to: data.status }
            ).catch(() => {});
          }

          if (hasFunnelStageChange) {
            dispatchWebhook(
              ctx.db,
              proj.workspaceId,
              issue.projectId,
              "issue.funnel_stage_changed",
              buildIssuePayload(issue),
              {
                field: "funnelStage",
                from: currentIssue.funnelStage,
                to: data.funnelStage ?? null,
              }
            ).catch(() => {});
          }

          if (user) {
            syncStatusToExternal(ctx.db, issue.id, data.status, user.id).catch(() => {});
          }
        } else if (hasFunnelStageChange) {
          dispatchWebhook(
            ctx.db,
            proj.workspaceId,
            issue.projectId,
            "issue.funnel_stage_changed",
            buildIssuePayload(issue),
            {
              field: "funnelStage",
              from: currentIssue.funnelStage,
              to: data.funnelStage ?? null,
            }
          ).catch(() => {});
        } else {
          dispatchWebhook(
            ctx.db,
            proj.workspaceId,
            issue.projectId,
            "issue.updated",
            buildIssuePayload(issue)
          ).catch(() => {});
        }

        if (bobIssueUpdate && activeBobRun) {
          dispatchWebhook(
            ctx.db,
            proj.workspaceId,
            issue.projectId,
            "issue.updated",
            buildIssuePayload(issue),
            undefined,
            {
              bobIssueUpdate,
            },
          ).catch(() => {});
        }
      }
    }

    return issue;
  }),

  delete: protectedProcedure
    .input(z.object({ id: z.string().uuid(), permanent: z.boolean().default(false) }))
    .mutation(async ({ ctx, input }) => {
      const [issue] = await ctx.db.select().from(issues).where(eq(issues.id, input.id)).limit(1);

      if (!issue) {
        throw new Error("Issue not found");
      }

      const [proj] = await ctx.db
        .select({ workspaceId: projects.workspaceId })
        .from(projects)
        .where(eq(projects.id, issue.projectId))
        .limit(1);

      if (proj) {
        publishIssueEvent(
          SSE_EVENTS.ISSUE_DELETED,
          proj.workspaceId,
          { id: issue.id, projectId: issue.projectId },
          issue.projectId,
          issue.id
        ).catch(() => {});

        dispatchWebhook(
          ctx.db,
          proj.workspaceId,
          issue.projectId,
          "issue.deleted",
          buildIssuePayload(issue)
        ).catch(() => {});
      }

      if (input.permanent) {
        await ctx.db.delete(issues).where(eq(issues.id, input.id));
      } else {
        await ctx.db.update(issues).set({ trashed: true, updatedAt: new Date() }).where(eq(issues.id, input.id));
      }

      return { success: true };
    }),

  restore: protectedProcedure.input(z.object({ id: z.string().uuid() })).mutation(async ({ ctx, input }) => {
    const [issue] = await ctx.db
      .update(issues)
      .set({ trashed: false, updatedAt: new Date() })
      .where(eq(issues.id, input.id))
      .returning();

    return issue;
  }),

  setLabels: protectedProcedure
    .input(
      z.object({
        issueId: z.string().uuid(),
        labelIds: z.array(z.string().uuid()),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await ctx.db.delete(issueLabels).where(eq(issueLabels.issueId, input.issueId));

      if (input.labelIds.length > 0) {
        await ctx.db.insert(issueLabels).values(
          input.labelIds.map((labelId) => ({
            issueId: input.issueId,
            labelId,
          }))
        );
      }

      return { success: true };
    }),

  addLabel: protectedProcedure
    .input(
      z.object({
        issueId: z.string().uuid(),
        labelId: z.string().uuid(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const user = ctx.user;

      await ctx.db.insert(issueLabels).values({
        issueId: input.issueId,
        labelId: input.labelId,
      });

      if (user) {
        await ctx.db.insert(activities).values({
          issueId: input.issueId,
          userId: user.id,
          type: "label_added",
          toValue: input.labelId,
        });
      }

      return { success: true };
    }),

  removeLabel: protectedProcedure
    .input(
      z.object({
        issueId: z.string().uuid(),
        labelId: z.string().uuid(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const user = ctx.user;

      await ctx.db
        .delete(issueLabels)
        .where(and(eq(issueLabels.issueId, input.issueId), eq(issueLabels.labelId, input.labelId)));

      if (user) {
        await ctx.db.insert(activities).values({
          issueId: input.issueId,
          userId: user.id,
          type: "label_removed",
          fromValue: input.labelId,
        });
      }

      return { success: true };
    }),

  subIssues: protectedProcedure.input(z.object({ parentId: z.string().uuid() })).query(async ({ ctx, input }) => {
    const result = await ctx.db
      .select({
        issue: issues,
        assignee: {
          id: users.id,
          name: users.name,
          avatarUrl: users.avatarUrl,
        },
      })
      .from(issues)
      .leftJoin(users, eq(issues.assigneeId, users.id))
      .where(eq(issues.parentId, input.parentId))
      .orderBy(issues.subIssuesSortOrder);

    return result.map((r) => ({
      ...r.issue,
      assignee: r.assignee,
    }));
  }),

  epicIssues: protectedProcedure.input(z.object({ epicId: z.string().uuid() })).query(async ({ ctx, input }) => {
    const result = await ctx.db
      .select({
        issue: issues,
        assignee: {
          id: users.id,
          name: users.name,
          avatarUrl: users.avatarUrl,
        },
        project: {
          id: projects.id,
          name: projects.name,
          key: projects.key,
          color: projects.color,
        },
      })
      .from(issues)
      .innerJoin(projects, eq(issues.projectId, projects.id))
      .leftJoin(users, eq(issues.assigneeId, users.id))
      .where(eq(issues.epicId, input.epicId))
      .orderBy(issues.sortOrder);

    return result.map((r) => ({
      ...r.issue,
      assignee: r.assignee,
      project: r.project,
    }));
  }),

  listEpics: protectedProcedure
    .input(z.object({ workspaceId: z.string().uuid(), projectId: z.string().uuid().optional() }))
    .query(async ({ ctx, input }) => {
      const conditions = [eq(issues.type, "epic"), eq(issues.trashed, false)];

      if (input.projectId) {
        conditions.push(eq(issues.projectId, input.projectId) as ReturnType<typeof eq>);
      }

      const result = await ctx.db
        .select({
          issue: issues,
          project: {
            id: projects.id,
            name: projects.name,
            key: projects.key,
            color: projects.color,
          },
        })
        .from(issues)
        .innerJoin(projects, eq(issues.projectId, projects.id))
        .where(and(eq(projects.workspaceId, input.workspaceId), ...conditions))
        .orderBy(desc(issues.createdAt));

      const epicIds = result.map((r) => r.issue.id);
      const issueCountsResult =
        epicIds.length > 0
          ? await ctx.db
              .select({
                epicId: issues.epicId,
                total: sql<number>`count(*)`,
                completed: sql<number>`count(*) filter (where ${issues.status} = 'done')`,
              })
              .from(issues)
              .where(inArray(issues.epicId, epicIds))
              .groupBy(issues.epicId)
          : [];

      const countsByEpic = new Map(issueCountsResult.map((c) => [c.epicId, { total: c.total, completed: c.completed }]));

      return result.map((r) => ({
        ...r.issue,
        project: r.project,
        issueCount: countsByEpic.get(r.issue.id)?.total ?? 0,
        completedCount: countsByEpic.get(r.issue.id)?.completed ?? 0,
      }));
    }),

  subscribe: protectedProcedure.input(z.object({ issueId: z.string().uuid() })).mutation(async ({ ctx, input }) => {
    const user = ctx.user;
    if (!user) {
      throw new Error("User not found");
    }

    await ctx.db
      .insert(issueSubscribers)
      .values({
        issueId: input.issueId,
        userId: user.id,
      })
      .onConflictDoNothing();

    return { success: true };
  }),

  unsubscribe: protectedProcedure.input(z.object({ issueId: z.string().uuid() })).mutation(async ({ ctx, input }) => {
    const user = ctx.user;
    if (!user) {
      throw new Error("User not found");
    }

    await ctx.db
      .delete(issueSubscribers)
      .where(and(eq(issueSubscribers.issueId, input.issueId), eq(issueSubscribers.userId, user.id)));

    return { success: true };
  }),

  activity: protectedProcedure.input(z.object({ issueId: z.string().uuid() })).query(async ({ ctx, input }) => {
    const result = await ctx.db
      .select({
        activity: activities,
        user: {
          id: users.id,
          name: users.name,
          email: users.email,
          avatarUrl: users.avatarUrl,
        },
      })
      .from(activities)
      .leftJoin(users, eq(activities.userId, users.id))
      .where(eq(activities.issueId, input.issueId))
      .orderBy(desc(activities.createdAt));

    return result.map((r) => ({
      ...r.activity,
      user: r.user,
    }));
  }),

  bulkUpdate: protectedProcedure
    .input(
      z.object({
        issueIds: z.array(z.string().uuid()),
        data: z.object({
          status: issueStatusEnum.optional(),
          priority: issuePriorityEnum.optional(),
          assigneeId: z.string().uuid().nullish(),
          projectId: z.string().uuid().optional(),
          teamId: z.string().uuid().nullish(),
          cycleId: z.string().uuid().nullish(),
          epicId: z.string().uuid().nullish(),
          funnelStage: issueFunnelStageEnum.optional(),
        }),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const beforeIssues = await ctx.db.select().from(issues).where(inArray(issues.id, input.issueIds));

      const updateData: Record<string, unknown> = { ...input.data, updatedAt: new Date() };

      if (input.data.status === "in_progress") {
        updateData.startedAt = sql`COALESCE(${issues.startedAt}, NOW())`;
      }
      if (input.data.status === "done") {
        updateData.completedAt = new Date();
      }
      if (input.data.status === "canceled") {
        updateData.canceledAt = new Date();
      }

      await ctx.db.update(issues).set(updateData).where(inArray(issues.id, input.issueIds));

      const afterIssues = await ctx.db.select().from(issues).where(inArray(issues.id, input.issueIds));

      const byId = new Map(beforeIssues.map((i) => [i.id, i]));
      const projectIds = Array.from(new Set(afterIssues.map((i) => i.projectId)));
      const projectRows =
        projectIds.length > 0
          ? await ctx.db
              .select({ id: projects.id, workspaceId: projects.workspaceId })
              .from(projects)
              .where(inArray(projects.id, projectIds))
          : [];
      const workspaceByProjectId = new Map(projectRows.map((p) => [p.id, p.workspaceId]));

      const hasAnyChange = Object.keys(input.data).length > 0;

      for (const issue of afterIssues) {
        const workspaceId = workspaceByProjectId.get(issue.projectId);
        if (!workspaceId) continue;

        const before = byId.get(issue.id);
        if (!before) continue;

        const hasStatusChange = input.data.status !== undefined && issue.status !== before.status;
        const hasFunnelStageChange =
          input.data.funnelStage !== undefined && issue.funnelStage !== before.funnelStage;

        if (hasStatusChange) {
          dispatchWebhook(
            ctx.db,
            workspaceId,
            issue.projectId,
            "issue.status_changed",
            buildIssuePayload(issue),
            { field: "status", from: before.status, to: issue.status }
          ).catch(() => {});

          if (issue.status === "done" && before.status !== "done") {
            dispatchWebhook(
              ctx.db,
              workspaceId,
              issue.projectId,
              "issue.completed",
              buildIssuePayload(issue),
              { field: "status", from: before.status, to: issue.status }
            ).catch(() => {});
          }
        }

        if (hasFunnelStageChange) {
          dispatchWebhook(
            ctx.db,
            workspaceId,
            issue.projectId,
            "issue.funnel_stage_changed",
            buildIssuePayload(issue),
            {
              field: "funnelStage",
              from: before.funnelStage,
              to: issue.funnelStage,
            }
          ).catch(() => {});
        }

        if (hasAnyChange && !hasStatusChange && !hasFunnelStageChange) {
          dispatchWebhook(
            ctx.db,
            workspaceId,
            issue.projectId,
            "issue.updated",
            buildIssuePayload(issue)
          ).catch(() => {});
        }
      }

      return { success: true, count: input.issueIds.length };
    }),

  moveToStatus: protectedProcedure
    .input(
      z.object({
        issueId: z.string().uuid(),
        status: issueStatusEnum,
        sortOrder: z.number().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const user = ctx.user;

      const [currentIssue] = await ctx.db.select().from(issues).where(eq(issues.id, input.issueId)).limit(1);

      if (!currentIssue) {
        throw new Error("Issue not found");
      }

      const updateData: Record<string, unknown> = {
        status: input.status,
        updatedAt: new Date(),
      };

      if (input.sortOrder !== undefined) {
        updateData.sortOrder = input.sortOrder;
      }

      if (input.status === "in_progress" && currentIssue.status !== "in_progress") {
        updateData.startedAt = currentIssue.startedAt ?? new Date();
      }
      if (input.status === "done" && currentIssue.status !== "done") {
        updateData.completedAt = new Date();
      }
      if (input.status === "canceled" && currentIssue.status !== "canceled") {
        updateData.canceledAt = new Date();
      }

      const [issue] = await ctx.db.update(issues).set(updateData).where(eq(issues.id, input.issueId)).returning();

      if (input.status !== currentIssue.status && user) {
        await ctx.db.insert(activities).values({
          issueId: input.issueId,
          userId: user.id,
          type: "status_changed",
          fromValue: currentIssue.status,
          toValue: input.status,
        });
      }

      if (issue && input.status !== currentIssue.status) {
        const [proj] = await ctx.db
          .select({ workspaceId: projects.workspaceId })
          .from(projects)
          .where(eq(projects.id, issue.projectId))
          .limit(1);

        if (proj) {
          dispatchWebhook(
            ctx.db,
            proj.workspaceId,
            issue.projectId,
            "issue.status_changed",
            buildIssuePayload(issue),
            { field: "status", from: currentIssue.status, to: input.status }
          ).catch(() => {});

          if (input.status === "done" && currentIssue.status !== "done") {
            dispatchWebhook(
              ctx.db,
              proj.workspaceId,
              issue.projectId,
              "issue.completed",
              buildIssuePayload(issue),
              { field: "status", from: currentIssue.status, to: input.status }
            ).catch(() => {});
          }
        }
      }

      return issue;
    }),

  dashboard: protectedProcedure
    .input(
      z.object({
        workspaceId: z.string().uuid(),
        dateRange: z.enum(["today", "week", "14days"]).default("week"),
      })
    )
    .query(async ({ ctx, input }) => {
      const user = ctx.user;
      if (!user) throw new Error("User not found");

      const now = new Date();
      const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const weekAgo = new Date(today);
      weekAgo.setDate(weekAgo.getDate() - 7);
      const twoWeeksAgo = new Date(today);
      twoWeeksAgo.setDate(twoWeeksAgo.getDate() - 14);
      const threeDaysFromNow = new Date(today);
      threeDaysFromNow.setDate(threeDaysFromNow.getDate() + 3);
      const weekFromNow = new Date(today);
      weekFromNow.setDate(weekFromNow.getDate() + 7);

      const rangeStart =
        input.dateRange === "today" ? today : input.dateRange === "week" ? weekAgo : twoWeeksAgo;

      const baseSelect = {
        issue: issues,
        project: {
          id: projects.id,
          name: projects.name,
          key: projects.key,
          color: projects.color,
        },
      };

      const inProgressTasks = await ctx.db
        .select(baseSelect)
        .from(issues)
        .innerJoin(projects, eq(issues.projectId, projects.id))
        .where(
          and(
            eq(projects.workspaceId, input.workspaceId),
            eq(issues.assigneeId, user.id),
            eq(issues.status, "in_progress"),
            eq(issues.trashed, false)
          )
        )
        .orderBy(desc(issues.updatedAt))
        .limit(10);

      const overdueTasks = await ctx.db
        .select(baseSelect)
        .from(issues)
        .innerJoin(projects, eq(issues.projectId, projects.id))
        .where(
          and(
            eq(projects.workspaceId, input.workspaceId),
            eq(issues.assigneeId, user.id),
            lte(issues.dueDate, now),
            inArray(issues.status, ["backlog", "todo", "in_progress", "in_review"]),
            eq(issues.trashed, false)
          )
        )
        .orderBy(asc(issues.dueDate))
        .limit(10);

      const dueSoonTasks = await ctx.db
        .select(baseSelect)
        .from(issues)
        .innerJoin(projects, eq(issues.projectId, projects.id))
        .where(
          and(
            eq(projects.workspaceId, input.workspaceId),
            eq(issues.assigneeId, user.id),
            gte(issues.dueDate, now),
            lte(issues.dueDate, threeDaysFromNow),
            inArray(issues.status, ["backlog", "todo", "in_progress", "in_review"]),
            eq(issues.trashed, false)
          )
        )
        .orderBy(asc(issues.dueDate))
        .limit(10);

      const dueThisWeekTasks = await ctx.db
        .select(baseSelect)
        .from(issues)
        .innerJoin(projects, eq(issues.projectId, projects.id))
        .where(
          and(
            eq(projects.workspaceId, input.workspaceId),
            eq(issues.assigneeId, user.id),
            gte(issues.dueDate, threeDaysFromNow),
            lte(issues.dueDate, weekFromNow),
            inArray(issues.status, ["backlog", "todo", "in_progress", "in_review"]),
            eq(issues.trashed, false)
          )
        )
        .orderBy(asc(issues.dueDate))
        .limit(10);

      const recentlyCompletedTasks = await ctx.db
        .select(baseSelect)
        .from(issues)
        .innerJoin(projects, eq(issues.projectId, projects.id))
        .where(
          and(
            eq(projects.workspaceId, input.workspaceId),
            eq(issues.assigneeId, user.id),
            eq(issues.status, "done"),
            gte(issues.completedAt, rangeStart),
            eq(issues.trashed, false)
          )
        )
        .orderBy(desc(issues.completedAt))
        .limit(20);

      const completionStats = await ctx.db
        .select({
          date: sql<string>`DATE(${issues.completedAt})`.as("date"),
          count: sql<number>`count(*)`.as("count"),
        })
        .from(issues)
        .innerJoin(projects, eq(issues.projectId, projects.id))
        .where(
          and(
            eq(projects.workspaceId, input.workspaceId),
            eq(issues.assigneeId, user.id),
            eq(issues.status, "done"),
            gte(issues.completedAt, twoWeeksAgo),
            eq(issues.trashed, false)
          )
        )
        .groupBy(sql`DATE(${issues.completedAt})`)
        .orderBy(asc(sql`DATE(${issues.completedAt})`));

      const completionByProject = await ctx.db
        .select({
          projectId: projects.id,
          projectName: projects.name,
          projectColor: projects.color,
          completedCount: sql<number>`count(*)`.as("completed_count"),
        })
        .from(issues)
        .innerJoin(projects, eq(issues.projectId, projects.id))
        .where(
          and(
            eq(projects.workspaceId, input.workspaceId),
            eq(issues.assigneeId, user.id),
            eq(issues.status, "done"),
            gte(issues.completedAt, rangeStart),
            eq(issues.trashed, false)
          )
        )
        .groupBy(projects.id, projects.name, projects.color)
        .orderBy(desc(sql`count(*)`))
        .limit(10);

      const formatTask = (r: (typeof inProgressTasks)[0]) => ({
        id: r.issue.id,
        identifier: r.issue.identifier,
        title: r.issue.title,
        status: r.issue.status,
        priority: r.issue.priority,
        dueDate: r.issue.dueDate,
        completedAt: r.issue.completedAt,
        project: r.project,
      });

      return {
        inProgress: inProgressTasks.map(formatTask),
        overdue: overdueTasks.map(formatTask),
        dueSoon: dueSoonTasks.map(formatTask),
        dueThisWeek: dueThisWeekTasks.map(formatTask),
        recentlyCompleted: recentlyCompletedTasks.map(formatTask),
        stats: {
          completionTrend: completionStats,
          completionByProject,
        },
      };
    }),

  reorder: protectedProcedure
    .input(
      z.object({
        issueId: z.string().uuid(),
        status: issueStatusEnum,
        kanbanRank: z.string(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const user = ctx.user;

      const [currentIssue] = await ctx.db.select().from(issues).where(eq(issues.id, input.issueId)).limit(1);

      if (!currentIssue) {
        throw new Error("Issue not found");
      }

      const updateData: Record<string, unknown> = {
        status: input.status,
        kanbanRank: input.kanbanRank,
        updatedAt: new Date(),
      };

      if (input.status === "in_progress" && currentIssue.status !== "in_progress") {
        updateData.startedAt = currentIssue.startedAt ?? new Date();
      }
      if (input.status === "done" && currentIssue.status !== "done") {
        updateData.completedAt = new Date();
      }
      if (input.status === "canceled" && currentIssue.status !== "canceled") {
        updateData.canceledAt = new Date();
      }

      const [issue] = await ctx.db.update(issues).set(updateData).where(eq(issues.id, input.issueId)).returning();

      if (input.status !== currentIssue.status && user) {
        await ctx.db.insert(activities).values({
          issueId: input.issueId,
          userId: user.id,
          type: "status_changed",
          fromValue: currentIssue.status,
          toValue: input.status,
        });
      }

      if (issue) {
        const [proj] = await ctx.db.select({ workspaceId: projects.workspaceId }).from(projects).where(eq(projects.id, issue.projectId)).limit(1);
        if (proj) {
          publishIssueEvent(
            SSE_EVENTS.ISSUE_REORDERED,
            proj.workspaceId,
            {
              id: issue.id,
              projectId: issue.projectId,
              status: issue.status,
              kanbanRank: issue.kanbanRank,
            },
            issue.projectId,
            issue.id
          ).catch(() => {});
        }
      }

      return issue;
    }),
});
