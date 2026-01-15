import { and, eq } from "@bob/db";
import { db } from "@bob/db/client";
import {
  chatConversations,
  pullRequests,
  repositories,
  taskRuns,
} from "@bob/db/schema";

import type { ContextReadiness } from "./contextHeuristics";
import {
  buildContextFromPR,
  evaluateContextReadiness,
} from "./contextHeuristics";

const KANBANGER_API_URL =
  process.env.KANBANGER_API_URL ?? "https://tasks.gmac.io/api";
const KANBANGER_API_KEY = process.env.KANBANGER_API_KEY;

export interface KanbangerCreateIssueInput {
  workspaceId: string;
  projectId: string;
  title: string;
  description?: string;
  labels?: string[];
  priority?: number;
}

export interface KanbangerIssue {
  id: string;
  identifier: string;
  title: string;
  description: string | null;
  url: string;
  priority: number;
  state: string;
}

export interface AutoCreateResult {
  created: boolean;
  taskId: string | null;
  taskIdentifier: string | null;
  taskUrl: string | null;
  contextReadiness: ContextReadiness;
  reason: string;
}

async function kanbangerRequest<T>(
  endpoint: string,
  method: "GET" | "POST" | "PATCH" = "GET",
  body?: Record<string, unknown>,
): Promise<T> {
  if (!KANBANGER_API_KEY) {
    throw new Error("KANBANGER_API_KEY is not configured");
  }

  const response = await fetch(`${KANBANGER_API_URL}${endpoint}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${KANBANGER_API_KEY}`,
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Kanbanger API error (${response.status}): ${errorText}`);
  }

  return response.json() as Promise<T>;
}

async function createKanbangerIssue(
  input: KanbangerCreateIssueInput,
): Promise<KanbangerIssue> {
  return kanbangerRequest<KanbangerIssue>(
    `/workspaces/${input.workspaceId}/issues`,
    "POST",
    {
      projectId: input.projectId,
      title: input.title,
      description: input.description,
      labels: input.labels,
      priority: input.priority ?? 2,
    },
  );
}

export async function addCommentToKanbangerIssue(
  workspaceId: string,
  issueId: string,
  body: string,
): Promise<void> {
  await kanbangerRequest(
    `/workspaces/${workspaceId}/issues/${issueId}/comments`,
    "POST",
    { body },
  );
}

function generateTaskDescription(
  pr: typeof pullRequests.$inferSelect,
  readiness: ContextReadiness,
): string {
  const lines: string[] = [];

  lines.push(`## Pull Request`);
  lines.push("");
  lines.push(`**[${pr.title}](${pr.url})**`);
  lines.push("");

  if (pr.body) {
    lines.push("### Description");
    lines.push("");
    lines.push(pr.body);
    lines.push("");
  }

  lines.push("### Details");
  lines.push("");
  lines.push(`- **Branch:** \`${pr.headBranch}\` → \`${pr.baseBranch}\``);
  lines.push(`- **Status:** ${pr.status}`);

  if (pr.additions !== null && pr.deletions !== null) {
    lines.push(
      `- **Changes:** +${pr.additions} / -${pr.deletions} (${pr.changedFiles ?? 0} files)`,
    );
  }

  lines.push("");
  lines.push("### Context Score");
  lines.push("");
  lines.push(`Score: ${readiness.score}/100`);

  if (readiness.suggestions.length > 0) {
    lines.push("");
    lines.push("**Suggestions:**");
    for (const suggestion of readiness.suggestions) {
      lines.push(`- ${suggestion}`);
    }
  }

  lines.push("");
  lines.push("---");
  lines.push("*Auto-created by Bob*");

  return lines.join("\n");
}

function extractLabelsFromBranch(branch: string): string[] {
  const labels: string[] = [];

  const lowerBranch = branch.toLowerCase();

  if (lowerBranch.includes("feature") || lowerBranch.includes("feat")) {
    labels.push("feature");
  }
  if (lowerBranch.includes("fix") || lowerBranch.includes("bug")) {
    labels.push("bug");
  }
  if (lowerBranch.includes("refactor")) {
    labels.push("refactor");
  }
  if (lowerBranch.includes("docs") || lowerBranch.includes("documentation")) {
    labels.push("documentation");
  }
  if (lowerBranch.includes("test")) {
    labels.push("testing");
  }
  if (lowerBranch.includes("chore") || lowerBranch.includes("maintenance")) {
    labels.push("maintenance");
  }

  return labels;
}

export interface AutoCreateFromPRInput {
  pullRequestId: string;
  userId: string;
  kanbangerWorkspaceId: string;
  kanbangerProjectId: string;
  forceCreate?: boolean;
  isFirstPush?: boolean;
}

export async function autoCreateTaskFromPR(
  input: AutoCreateFromPRInput,
): Promise<AutoCreateResult> {
  const pr = await db.query.pullRequests.findFirst({
    where: and(
      eq(pullRequests.id, input.pullRequestId),
      eq(pullRequests.userId, input.userId),
    ),
  });

  if (!pr) {
    return {
      created: false,
      taskId: null,
      taskIdentifier: null,
      taskUrl: null,
      contextReadiness: {
        ready: false,
        gates: {
          hardRequirements: {
            passed: false,
            gate: "hard_requirements",
            reason: "Pull request not found",
          },
          lifecycle: {
            passed: false,
            gate: "lifecycle",
            reason: "Pull request not found",
          },
          quality: {
            passed: false,
            gate: "quality",
            reason: "Pull request not found",
          },
        },
        score: 0,
        suggestions: [],
      },
      reason: "Pull request not found",
    };
  }

  if (pr.kanbangerTaskId && !input.forceCreate) {
    return {
      created: false,
      taskId: pr.kanbangerTaskId,
      taskIdentifier: null,
      taskUrl: null,
      contextReadiness: {
        ready: true,
        gates: {
          hardRequirements: {
            passed: true,
            gate: "hard_requirements",
            reason: "Already linked",
          },
          lifecycle: {
            passed: true,
            gate: "lifecycle",
            reason: "Already linked",
          },
          quality: { passed: true, gate: "quality", reason: "Already linked" },
        },
        score: 100,
        suggestions: [],
      },
      reason: "PR already linked to a Kanbanger task",
    };
  }

  const repo = pr.repositoryId
    ? await db.query.repositories.findFirst({
        where: eq(repositories.id, pr.repositoryId),
      })
    : null;

  const contextInput = buildContextFromPR(
    pr,
    repo ?? null,
    input.isFirstPush ?? false,
  );
  const readiness = evaluateContextReadiness(contextInput);

  if (!readiness.ready && !input.forceCreate) {
    return {
      created: false,
      taskId: null,
      taskIdentifier: null,
      taskUrl: null,
      contextReadiness: readiness,
      reason: `Context not ready: ${Object.entries(readiness.gates)
        .filter(([, g]) => !g.passed)
        .map(([name, g]) => `${name}: ${g.reason}`)
        .join("; ")}`,
    };
  }

  const labels = extractLabelsFromBranch(pr.headBranch);
  const description = generateTaskDescription(pr, readiness);

  try {
    const issue = await createKanbangerIssue({
      workspaceId: input.kanbangerWorkspaceId,
      projectId: input.kanbangerProjectId,
      title: pr.title,
      description,
      labels,
      priority: 2,
    });

    await db
      .update(pullRequests)
      .set({ kanbangerTaskId: issue.id })
      .where(eq(pullRequests.id, pr.id));

    if (pr.sessionId) {
      await db
        .update(chatConversations)
        .set({ kanbangerTaskId: issue.id })
        .where(eq(chatConversations.id, pr.sessionId));
    }

    return {
      created: true,
      taskId: issue.id,
      taskIdentifier: issue.identifier,
      taskUrl: issue.url,
      contextReadiness: readiness,
      reason: "Task created successfully",
    };
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";
    return {
      created: false,
      taskId: null,
      taskIdentifier: null,
      taskUrl: null,
      contextReadiness: readiness,
      reason: `Failed to create Kanbanger task: ${errorMessage}`,
    };
  }
}

export interface CheckAndCreateInput {
  userId: string;
  branch: string;
  repositoryId: string;
  kanbangerWorkspaceId: string;
  kanbangerProjectId: string;
  isFirstPush?: boolean;
}

export async function checkAndCreateTaskIfReady(
  input: CheckAndCreateInput,
): Promise<AutoCreateResult | null> {
  const pr = await db.query.pullRequests.findFirst({
    where: and(
      eq(pullRequests.userId, input.userId),
      eq(pullRequests.repositoryId, input.repositoryId),
      eq(pullRequests.headBranch, input.branch),
    ),
    orderBy: (pr, { desc }) => [desc(pr.createdAt)],
  });

  if (!pr) {
    return null;
  }

  return autoCreateTaskFromPR({
    pullRequestId: pr.id,
    userId: input.userId,
    kanbangerWorkspaceId: input.kanbangerWorkspaceId,
    kanbangerProjectId: input.kanbangerProjectId,
    isFirstPush: input.isFirstPush,
  });
}

export async function linkTaskRunToPR(
  taskRunId: string,
  pullRequestId: string,
): Promise<void> {
  await db
    .update(taskRuns)
    .set({ pullRequestId })
    .where(eq(taskRuns.id, taskRunId));
}

export async function getTaskRunForPR(
  pullRequestId: string,
): Promise<typeof taskRuns.$inferSelect | null> {
  const taskRun = await db.query.taskRuns.findFirst({
    where: eq(taskRuns.pullRequestId, pullRequestId),
    orderBy: (t, { desc }) => [desc(t.createdAt)],
  });

  return taskRun ?? null;
}

export async function findActiveTaskRunByBranch(
  userId: string,
  branch: string,
): Promise<typeof taskRuns.$inferSelect | null> {
  const taskRun = await db.query.taskRuns.findFirst({
    where: and(
      eq(taskRuns.userId, userId),
      eq(taskRuns.branch, branch),
      eq(taskRuns.status, "running"),
    ),
    orderBy: (t, { desc }) => [desc(t.createdAt)],
  });

  return taskRun ?? null;
}
