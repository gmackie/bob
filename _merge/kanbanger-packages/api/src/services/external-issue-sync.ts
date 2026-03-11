import { eq, and } from "drizzle-orm";
import { projects, users, issues, activities, type Database } from "@linear-clone/db";

interface ExternalIssue {
  id: string;
  number: number;
  url: string;
  provider: "github" | "gitea";
}

interface IssueData {
  id: string;
  identifier: string;
  title: string;
  description: string | null;
  status: string;
  priority: string;
}

const STATUS_TO_EXTERNAL_STATE: Record<string, { open: boolean; state?: string }> = {
  backlog: { open: true },
  todo: { open: true },
  in_progress: { open: true },
  in_review: { open: true },
  done: { open: false },
  canceled: { open: false },
};

const EXTERNAL_STATE_TO_STATUS: Record<string, Record<string, string>> = {
  github: {
    open: "todo",
    closed: "done",
  },
  gitea: {
    open: "todo",
    closed: "done",
  },
};

export async function createExternalIssue(
  db: Database,
  projectId: string,
  issue: IssueData,
  userId: string
): Promise<ExternalIssue | null> {
  const [project] = await db
    .select()
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);

  if (!project) return null;

  if (!project.issueSyncEnabled || !project.repositoryProvider || !project.repositoryFullName) {
    return null;
  }

  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user) return null;

  const provider = project.repositoryProvider as "github" | "gitea";
  const accessToken = provider === "github" ? user.githubAccessToken : user.giteaAccessToken;

  if (!accessToken) {
    console.warn(`User ${userId} has no ${provider} access token for external issue sync`);
    return null;
  }

  try {
    const externalIssue = await createIssueOnProvider(
      provider,
      project.repositoryFullName,
      accessToken,
      issue
    );

    if (externalIssue) {
      await db
        .update(issues)
        .set({
          externalIssueProvider: provider,
          externalIssueId: externalIssue.id,
          externalIssueNumber: externalIssue.number,
          externalIssueUrl: externalIssue.url,
          externalIssueSyncedAt: new Date(),
        })
        .where(eq(issues.id, issue.id));

      await db.insert(activities).values({
        issueId: issue.id,
        userId,
        type: "linked_to_pr",
        metadata: {
          externalProvider: provider,
          externalIssueNumber: externalIssue.number,
          externalIssueUrl: externalIssue.url,
          action: "created",
        },
      });
    }

    return externalIssue;
  } catch (error) {
    console.error(`Failed to create external ${provider} issue:`, error);
    return null;
  }
}

export async function syncStatusToExternal(
  db: Database,
  issueId: string,
  newStatus: string,
  userId: string
): Promise<boolean> {
  const [issue] = await db.select().from(issues).where(eq(issues.id, issueId)).limit(1);

  if (!issue) return false;
  if (!issue.externalIssueProvider || !issue.externalIssueNumber) return false;

  const [project] = await db
    .select()
    .from(projects)
    .where(eq(projects.id, issue.projectId))
    .limit(1);

  if (!project) return false;
  if (!project.issueSyncEnabled) return false;

  const syncDirection = project.issueSyncDirection ?? "bidirectional";
  if (syncDirection === "inbound_only") return false;

  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user) return false;

  const provider = issue.externalIssueProvider as "github" | "gitea";
  const accessToken = provider === "github" ? user.githubAccessToken : user.giteaAccessToken;

  if (!accessToken || !project.repositoryFullName) return false;

  try {
    const externalState = STATUS_TO_EXTERNAL_STATE[newStatus];
    if (!externalState) return false;

    await updateExternalIssueState(
      provider,
      project.repositoryFullName,
      accessToken,
      issue.externalIssueNumber,
      externalState.open ? "open" : "closed"
    );

    await db
      .update(issues)
      .set({ externalIssueSyncedAt: new Date() })
      .where(eq(issues.id, issueId));

    return true;
  } catch (error) {
    console.error(`Failed to sync status to external ${provider} issue:`, error);
    return false;
  }
}

export async function syncStatusFromExternal(
  db: Database,
  provider: "github" | "gitea",
  repoFullName: string,
  externalIssueNumber: number,
  externalState: string
): Promise<boolean> {
  const [project] = await db
    .select()
    .from(projects)
    .where(
      and(
        eq(projects.repositoryProvider, provider),
        eq(projects.repositoryFullName, repoFullName),
        eq(projects.issueSyncEnabled, true)
      )
    )
    .limit(1);

  if (!project) return false;

  const syncDirection = project.issueSyncDirection ?? "bidirectional";
  if (syncDirection === "outbound_only") return false;

  const [issue] = await db
    .select()
    .from(issues)
    .where(
      and(
        eq(issues.externalIssueProvider, provider),
        eq(issues.externalIssueNumber, externalIssueNumber),
        eq(issues.projectId, project.id)
      )
    )
    .limit(1);

  if (!issue) return false;

  const statusMap = EXTERNAL_STATE_TO_STATUS[provider];
  const newStatus = statusMap?.[externalState];

  if (!newStatus) return false;
  if (issue.status === newStatus) return false;

  const updateData: Record<string, unknown> = {
    status: newStatus,
    updatedAt: new Date(),
    externalIssueSyncedAt: new Date(),
  };

  if (newStatus === "done" && issue.status !== "done") {
    updateData.completedAt = new Date();
  }

  await db.update(issues).set(updateData).where(eq(issues.id, issue.id));

  await db.insert(activities).values({
    issueId: issue.id,
    type: "status_changed",
    fromValue: issue.status,
    toValue: newStatus,
    changes: {
      field: "status",
      from: issue.status,
      to: newStatus,
      reason: `${provider} issue #${externalIssueNumber} ${externalState}`,
    },
  });

  return true;
}

async function createIssueOnProvider(
  provider: "github" | "gitea",
  repoFullName: string,
  accessToken: string,
  issue: IssueData
): Promise<ExternalIssue | null> {
  const body = formatIssueBody(issue);

  if (provider === "github") {
    return createGitHubIssue(repoFullName, accessToken, issue.title, body);
  } else {
    return createGiteaIssue(repoFullName, accessToken, issue.title, body);
  }
}

async function createGitHubIssue(
  repoFullName: string,
  accessToken: string,
  title: string,
  body: string
): Promise<ExternalIssue | null> {
  const [owner, repo] = repoFullName.split("/");

  const response = await fetch(`https://api.github.com/repos/${owner}/${repo}/issues`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/vnd.github.v3+json",
      "Content-Type": "application/json",
      "User-Agent": "TasksGmac/1.0",
    },
    body: JSON.stringify({ title, body }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`GitHub API error: ${response.status} - ${errorText}`);
  }

  const data = await response.json() as { id: number; number: number; html_url: string };

  return {
    id: String(data.id),
    number: data.number,
    url: data.html_url,
    provider: "github",
  };
}

async function createGiteaIssue(
  repoFullName: string,
  accessToken: string,
  title: string,
  body: string
): Promise<ExternalIssue | null> {
  const giteaUrl = process.env.GITEA_URL ?? "https://git.gmac.io";
  const [owner, repo] = repoFullName.split("/");

  const response = await fetch(`${giteaUrl}/api/v1/repos/${owner}/${repo}/issues`, {
    method: "POST",
    headers: {
      Authorization: `token ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ title, body }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Gitea API error: ${response.status} - ${errorText}`);
  }

  const data = await response.json() as { id: number; number: number; html_url: string };

  return {
    id: String(data.id),
    number: data.number,
    url: data.html_url,
    provider: "gitea",
  };
}

async function updateExternalIssueState(
  provider: "github" | "gitea",
  repoFullName: string,
  accessToken: string,
  issueNumber: number,
  state: "open" | "closed"
): Promise<void> {
  if (provider === "github") {
    await updateGitHubIssueState(repoFullName, accessToken, issueNumber, state);
  } else {
    await updateGiteaIssueState(repoFullName, accessToken, issueNumber, state);
  }
}

async function updateGitHubIssueState(
  repoFullName: string,
  accessToken: string,
  issueNumber: number,
  state: "open" | "closed"
): Promise<void> {
  const [owner, repo] = repoFullName.split("/");

  const response = await fetch(`https://api.github.com/repos/${owner}/${repo}/issues/${issueNumber}`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/vnd.github.v3+json",
      "Content-Type": "application/json",
      "User-Agent": "TasksGmac/1.0",
    },
    body: JSON.stringify({ state }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`GitHub API error: ${response.status} - ${errorText}`);
  }
}

async function updateGiteaIssueState(
  repoFullName: string,
  accessToken: string,
  issueNumber: number,
  state: "open" | "closed"
): Promise<void> {
  const giteaUrl = process.env.GITEA_URL ?? "https://git.gmac.io";
  const [owner, repo] = repoFullName.split("/");

  const response = await fetch(`${giteaUrl}/api/v1/repos/${owner}/${repo}/issues/${issueNumber}`, {
    method: "PATCH",
    headers: {
      Authorization: `token ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ state }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Gitea API error: ${response.status} - ${errorText}`);
  }
}

function formatIssueBody(issue: IssueData): string {
  const parts: string[] = [];

  if (issue.description) {
    parts.push(issue.description);
    parts.push("");
  }

  parts.push("---");
  parts.push(`Synced from [${issue.identifier}](${process.env.NEXT_PUBLIC_APP_URL ?? "https://tasks.gmac.io"}/issue/${issue.identifier})`);

  return parts.join("\n");
}
