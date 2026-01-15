import { and, eq, or } from "@bob/db";
import { db } from "@bob/db/client";
import {
  chatConversations,
  gitCommits,
  pullRequests,
  repositories,
} from "@bob/db/schema";

import type {
  CreatePullRequestInput,
  GitCommit,
  GitProvider,
  GitProviderClient,
  GitPullRequest,
} from "./providers/types";
import {
  createProviderClient,
  getConnection,
} from "./providerConnectionService";

export interface CreateDraftPrInput {
  userId: string;
  repositoryId: string;
  sessionId?: string;
  title: string;
  body?: string;
  headBranch: string;
  baseBranch?: string;
  draft?: boolean;
  kanbangerTaskId?: string;
}

export interface UpdatePrInput {
  userId: string;
  pullRequestId: string;
  title?: string;
  body?: string;
  state?: "open" | "closed";
}

export interface MergePrInput {
  userId: string;
  pullRequestId: string;
  mergeMethod?: "merge" | "squash" | "rebase";
}

export interface SyncCommitsInput {
  userId: string;
  pullRequestId: string;
}

export interface PrWithCommits {
  id: string;
  userId: string;
  repositoryId: string | null;
  provider: string;
  instanceUrl: string | null;
  remoteOwner: string;
  remoteName: string;
  number: number;
  headBranch: string;
  baseBranch: string;
  title: string;
  body: string | null;
  status: string;
  url: string;
  sessionId: string | null;
  kanbangerTaskId: string | null;
  additions: number | null;
  deletions: number | null;
  changedFiles: number | null;
  createdAt: Date;
  updatedAt: Date | null;
  mergedAt: Date | null;
  closedAt: Date | null;
  commits: Array<{
    sha: string;
    message: string;
    authorName: string | null;
    authorEmail: string | null;
    committedAt: Date;
    isBobCommit: boolean;
  }>;
}

async function getRepoWithConnection(
  userId: string,
  repositoryId: string,
): Promise<{
  repo: NonNullable<
    Awaited<ReturnType<typeof db.query.repositories.findFirst>>
  >;
  client: GitProviderClient;
  provider: GitProvider;
  instanceUrl: string | null;
}> {
  const repo = await db.query.repositories.findFirst({
    where: and(
      eq(repositories.id, repositoryId),
      eq(repositories.userId, userId),
    ),
  });

  if (!repo) {
    throw new Error("Repository not found");
  }

  if (!repo.remoteProvider || !repo.remoteOwner || !repo.remoteName) {
    throw new Error(
      "Repository is not connected to a remote provider. Please configure the remote URL first.",
    );
  }

  const provider = repo.remoteProvider as GitProvider;
  const instanceUrl = repo.remoteInstanceUrl;

  const connection = await getConnection(userId, provider, instanceUrl);
  if (!connection) {
    throw new Error(
      `No ${provider} connection found. Please connect your ${provider} account first.`,
    );
  }

  const client = createProviderClient(
    provider,
    connection.accessToken,
    instanceUrl,
  );

  return { repo, client, provider, instanceUrl };
}

function mapPrStatus(
  pr: GitPullRequest,
): "draft" | "open" | "merged" | "closed" {
  if (pr.state === "merged") return "merged";
  if (pr.state === "closed") return "closed";
  if (pr.draft) return "draft";
  return "open";
}

export async function createDraftPr(
  input: CreateDraftPrInput,
): Promise<PrWithCommits> {
  const { repo, client, provider, instanceUrl } = await getRepoWithConnection(
    input.userId,
    input.repositoryId,
  );

  const baseBranch = input.baseBranch ?? repo.mainBranch;

  const createInput: CreatePullRequestInput = {
    owner: repo.remoteOwner!,
    repo: repo.remoteName!,
    title: input.title,
    body: input.body,
    head: input.headBranch,
    base: baseBranch,
    draft: input.draft ?? true,
  };

  const remotePr = await client.createPullRequest(createInput);

  const [prRecord] = await db
    .insert(pullRequests)
    .values({
      userId: input.userId,
      repositoryId: input.repositoryId,
      gitProviderConnectionId: repo.gitProviderConnectionId,
      provider,
      instanceUrl,
      remoteOwner: repo.remoteOwner!,
      remoteName: repo.remoteName!,
      number: remotePr.number,
      headBranch: remotePr.headBranch,
      baseBranch: remotePr.baseBranch,
      title: remotePr.title,
      body: remotePr.body,
      status: mapPrStatus(remotePr),
      url: remotePr.url,
      sessionId: input.sessionId ?? null,
      kanbangerTaskId: input.kanbangerTaskId ?? null,
      additions: remotePr.additions ?? null,
      deletions: remotePr.deletions ?? null,
      changedFiles: remotePr.changedFiles ?? null,
    })
    .returning();

  if (input.sessionId) {
    await db
      .update(chatConversations)
      .set({
        pullRequestId: prRecord!.id,
        gitBranch: input.headBranch,
      })
      .where(eq(chatConversations.id, input.sessionId));
  }

  const commits = await syncPrCommits(
    client,
    prRecord!.id,
    repo.remoteOwner!,
    repo.remoteName!,
    remotePr.number,
    provider,
    instanceUrl,
    input.repositoryId,
    input.sessionId,
  );

  return {
    ...prRecord!,
    commits,
  };
}

export async function updatePr(input: UpdatePrInput): Promise<PrWithCommits> {
  const prRecord = await db.query.pullRequests.findFirst({
    where: and(
      eq(pullRequests.id, input.pullRequestId),
      eq(pullRequests.userId, input.userId),
    ),
  });

  if (!prRecord) {
    throw new Error("Pull request not found");
  }

  const connection = await getConnection(
    input.userId,
    prRecord.provider as GitProvider,
    prRecord.instanceUrl,
  );

  if (!connection) {
    throw new Error(
      `No ${prRecord.provider} connection found. Please reconnect your account.`,
    );
  }

  const client = createProviderClient(
    prRecord.provider as GitProvider,
    connection.accessToken,
    prRecord.instanceUrl,
  );

  const remotePr = await client.updatePullRequest({
    owner: prRecord.remoteOwner,
    repo: prRecord.remoteName,
    number: prRecord.number,
    title: input.title,
    body: input.body,
    state: input.state,
  });

  const [updatedPr] = await db
    .update(pullRequests)
    .set({
      title: remotePr.title,
      body: remotePr.body,
      status: mapPrStatus(remotePr),
      additions: remotePr.additions ?? prRecord.additions,
      deletions: remotePr.deletions ?? prRecord.deletions,
      changedFiles: remotePr.changedFiles ?? prRecord.changedFiles,
      closedAt: remotePr.closedAt,
    })
    .where(eq(pullRequests.id, input.pullRequestId))
    .returning();

  const commits = await db.query.gitCommits.findMany({
    where: eq(gitCommits.pullRequestId, input.pullRequestId),
    orderBy: (c, { desc }) => [desc(c.committedAt)],
  });

  return {
    ...updatedPr!,
    commits: commits.map((c) => ({
      sha: c.sha,
      message: c.message,
      authorName: c.authorName,
      authorEmail: c.authorEmail,
      committedAt: c.committedAt,
      isBobCommit: c.isBobCommit,
    })),
  };
}

export async function mergePr(
  input: MergePrInput,
): Promise<{ success: boolean; mergedAt: Date }> {
  const prRecord = await db.query.pullRequests.findFirst({
    where: and(
      eq(pullRequests.id, input.pullRequestId),
      eq(pullRequests.userId, input.userId),
    ),
  });

  if (!prRecord) {
    throw new Error("Pull request not found");
  }

  if (prRecord.status === "merged") {
    throw new Error("Pull request is already merged");
  }

  if (prRecord.status === "closed") {
    throw new Error("Cannot merge a closed pull request");
  }

  const connection = await getConnection(
    input.userId,
    prRecord.provider as GitProvider,
    prRecord.instanceUrl,
  );

  if (!connection) {
    throw new Error(
      `No ${prRecord.provider} connection found. Please reconnect your account.`,
    );
  }

  const client = createProviderClient(
    prRecord.provider as GitProvider,
    connection.accessToken,
    prRecord.instanceUrl,
  );

  await client.mergePullRequest(
    prRecord.remoteOwner,
    prRecord.remoteName,
    prRecord.number,
    input.mergeMethod ?? "squash",
  );

  const mergedAt = new Date();

  await db
    .update(pullRequests)
    .set({
      status: "merged",
      mergedAt,
    })
    .where(eq(pullRequests.id, input.pullRequestId));

  return { success: true, mergedAt };
}

async function syncPrCommits(
  client: GitProviderClient,
  pullRequestId: string,
  owner: string,
  repo: string,
  prNumber: number,
  provider: GitProvider,
  instanceUrl: string | null,
  repositoryId: string,
  sessionId?: string | null,
): Promise<
  Array<{
    sha: string;
    message: string;
    authorName: string | null;
    authorEmail: string | null;
    committedAt: Date;
    isBobCommit: boolean;
  }>
> {
  const remoteCommits = await client.listPullRequestCommits(
    owner,
    repo,
    prNumber,
  );

  const commitRecords: Array<{
    sha: string;
    message: string;
    authorName: string | null;
    authorEmail: string | null;
    committedAt: Date;
    isBobCommit: boolean;
  }> = [];

  for (const commit of remoteCommits) {
    const isBobCommit = detectBobCommit(commit);

    await db
      .insert(gitCommits)
      .values({
        repositoryId,
        pullRequestId,
        provider,
        instanceUrl,
        remoteOwner: owner,
        remoteName: repo,
        sha: commit.sha,
        message: commit.message,
        authorName: commit.authorName,
        authorEmail: commit.authorEmail,
        committedAt: commit.committedAt,
        sessionId: sessionId ?? null,
        isBobCommit,
      })
      .onConflictDoNothing();

    commitRecords.push({
      sha: commit.sha,
      message: commit.message,
      authorName: commit.authorName,
      authorEmail: commit.authorEmail ?? null,
      committedAt: commit.committedAt,
      isBobCommit,
    });
  }

  return commitRecords;
}

export async function syncCommits(input: SyncCommitsInput): Promise<{
  synced: number;
  commits: Array<{
    sha: string;
    message: string;
    authorName: string | null;
    authorEmail: string | null;
    committedAt: Date;
    isBobCommit: boolean;
  }>;
}> {
  const prRecord = await db.query.pullRequests.findFirst({
    where: and(
      eq(pullRequests.id, input.pullRequestId),
      eq(pullRequests.userId, input.userId),
    ),
  });

  if (!prRecord) {
    throw new Error("Pull request not found");
  }

  const connection = await getConnection(
    input.userId,
    prRecord.provider as GitProvider,
    prRecord.instanceUrl,
  );

  if (!connection) {
    throw new Error(
      `No ${prRecord.provider} connection found. Please reconnect your account.`,
    );
  }

  const client = createProviderClient(
    prRecord.provider as GitProvider,
    connection.accessToken,
    prRecord.instanceUrl,
  );

  const commits = await syncPrCommits(
    client,
    prRecord.id,
    prRecord.remoteOwner,
    prRecord.remoteName,
    prRecord.number,
    prRecord.provider as GitProvider,
    prRecord.instanceUrl,
    prRecord.repositoryId ?? "",
    prRecord.sessionId,
  );

  return {
    synced: commits.length,
    commits,
  };
}

export async function getPrById(
  userId: string,
  pullRequestId: string,
): Promise<PrWithCommits | null> {
  const prRecord = await db.query.pullRequests.findFirst({
    where: and(
      eq(pullRequests.id, pullRequestId),
      eq(pullRequests.userId, userId),
    ),
  });

  if (!prRecord) {
    return null;
  }

  const commits = await db.query.gitCommits.findMany({
    where: eq(gitCommits.pullRequestId, pullRequestId),
    orderBy: (c, { desc }) => [desc(c.committedAt)],
  });

  return {
    ...prRecord,
    commits: commits.map((c) => ({
      sha: c.sha,
      message: c.message,
      authorName: c.authorName,
      authorEmail: c.authorEmail,
      committedAt: c.committedAt,
      isBobCommit: c.isBobCommit,
    })),
  };
}

export async function listPrsByRepository(
  userId: string,
  repositoryId: string,
  options?: {
    status?: "draft" | "open" | "merged" | "closed";
    limit?: number;
    includeCommits?: boolean;
  },
): Promise<Array<PrWithCommits>> {
  const conditions = [
    eq(pullRequests.userId, userId),
    eq(pullRequests.repositoryId, repositoryId),
  ];

  if (options?.status) {
    conditions.push(eq(pullRequests.status, options.status));
  }

  const prs = await db.query.pullRequests.findMany({
    where: and(...conditions),
    orderBy: (pr, { desc }) => [desc(pr.createdAt)],
    limit: options?.limit ?? 50,
  });

  if (!options?.includeCommits) {
    return prs.map((pr) => ({ ...pr, commits: [] }));
  }

  const prIds = prs.map((pr) => pr.id);
  const commits =
    prIds.length > 0
      ? await db.query.gitCommits.findMany({
          where: or(...prIds.map((id) => eq(gitCommits.pullRequestId, id))),
          orderBy: (c, { desc }) => [desc(c.committedAt)],
        })
      : [];

  const commitsByPr = new Map<string, typeof commits>();
  for (const commit of commits) {
    if (commit.pullRequestId) {
      const prCommits = commitsByPr.get(commit.pullRequestId) ?? [];
      prCommits.push(commit);
      commitsByPr.set(commit.pullRequestId, prCommits);
    }
  }

  return prs.map((pr) => ({
    ...pr,
    commits: (commitsByPr.get(pr.id) ?? []).map((c) => ({
      sha: c.sha,
      message: c.message,
      authorName: c.authorName,
      authorEmail: c.authorEmail,
      committedAt: c.committedAt,
      isBobCommit: c.isBobCommit,
    })),
  }));
}

export async function listPrsBySession(
  userId: string,
  sessionId: string,
): Promise<Array<PrWithCommits>> {
  const prs = await db.query.pullRequests.findMany({
    where: and(
      eq(pullRequests.userId, userId),
      eq(pullRequests.sessionId, sessionId),
    ),
    orderBy: (pr, { desc }) => [desc(pr.createdAt)],
  });

  const prIds = prs.map((pr) => pr.id);
  const commits =
    prIds.length > 0
      ? await db.query.gitCommits.findMany({
          where: or(...prIds.map((id) => eq(gitCommits.pullRequestId, id))),
          orderBy: (c, { desc }) => [desc(c.committedAt)],
        })
      : [];

  const commitsByPr = new Map<string, typeof commits>();
  for (const commit of commits) {
    if (commit.pullRequestId) {
      const prCommits = commitsByPr.get(commit.pullRequestId) ?? [];
      prCommits.push(commit);
      commitsByPr.set(commit.pullRequestId, prCommits);
    }
  }

  return prs.map((pr) => ({
    ...pr,
    commits: (commitsByPr.get(pr.id) ?? []).map((c) => ({
      sha: c.sha,
      message: c.message,
      authorName: c.authorName,
      authorEmail: c.authorEmail,
      committedAt: c.committedAt,
      isBobCommit: c.isBobCommit,
    })),
  }));
}

export async function linkPrToKanbangerTask(
  userId: string,
  pullRequestId: string,
  kanbangerTaskId: string,
): Promise<void> {
  await db
    .update(pullRequests)
    .set({ kanbangerTaskId })
    .where(
      and(eq(pullRequests.id, pullRequestId), eq(pullRequests.userId, userId)),
    );
}

export async function refreshPrFromRemote(
  userId: string,
  pullRequestId: string,
): Promise<PrWithCommits> {
  const prRecord = await db.query.pullRequests.findFirst({
    where: and(
      eq(pullRequests.id, pullRequestId),
      eq(pullRequests.userId, userId),
    ),
  });

  if (!prRecord) {
    throw new Error("Pull request not found");
  }

  const connection = await getConnection(
    userId,
    prRecord.provider as GitProvider,
    prRecord.instanceUrl,
  );

  if (!connection) {
    throw new Error(
      `No ${prRecord.provider} connection found. Please reconnect your account.`,
    );
  }

  const client = createProviderClient(
    prRecord.provider as GitProvider,
    connection.accessToken,
    prRecord.instanceUrl,
  );

  const remotePr = await client.getPullRequest(
    prRecord.remoteOwner,
    prRecord.remoteName,
    prRecord.number,
  );

  const [updatedPr] = await db
    .update(pullRequests)
    .set({
      title: remotePr.title,
      body: remotePr.body,
      status: mapPrStatus(remotePr),
      additions: remotePr.additions ?? prRecord.additions,
      deletions: remotePr.deletions ?? prRecord.deletions,
      changedFiles: remotePr.changedFiles ?? prRecord.changedFiles,
      mergedAt: remotePr.mergedAt,
      closedAt: remotePr.closedAt,
    })
    .where(eq(pullRequests.id, pullRequestId))
    .returning();

  const commits = await syncPrCommits(
    client,
    prRecord.id,
    prRecord.remoteOwner,
    prRecord.remoteName,
    prRecord.number,
    prRecord.provider as GitProvider,
    prRecord.instanceUrl,
    prRecord.repositoryId ?? "",
    prRecord.sessionId,
  );

  return {
    ...updatedPr!,
    commits,
  };
}

function detectBobCommit(commit: GitCommit): boolean {
  const email = commit.authorEmail?.toLowerCase() ?? "";
  const name = commit.authorName?.toLowerCase() ?? "";
  const message = commit.message.toLowerCase();

  if (
    email.includes("bob@") ||
    email.includes("bob+") ||
    email.includes("noreply")
  ) {
    return true;
  }

  if (name.includes("bob") || name.includes("[bot]")) {
    return true;
  }

  if (message.includes("[bob]") || message.includes("generated by bob")) {
    return true;
  }

  return false;
}

export async function upsertPrFromWebhook(params: {
  userId: string;
  provider: GitProvider;
  instanceUrl: string | null;
  remoteOwner: string;
  remoteName: string;
  number: number;
  headBranch: string;
  baseBranch: string;
  title: string;
  body: string | null;
  url: string;
  draft: boolean;
  state: "open" | "closed" | "merged";
  additions?: number;
  deletions?: number;
  changedFiles?: number;
  mergedAt?: Date | null;
  closedAt?: Date | null;
}): Promise<string> {
  const repo = await db.query.repositories.findFirst({
    where: and(
      eq(repositories.userId, params.userId),
      eq(repositories.remoteOwner, params.remoteOwner),
      eq(repositories.remoteName, params.remoteName),
    ),
  });

  const status =
    params.state === "merged"
      ? "merged"
      : params.state === "closed"
        ? "closed"
        : params.draft
          ? "draft"
          : "open";

  const existingPr = await db.query.pullRequests.findFirst({
    where: and(
      eq(pullRequests.userId, params.userId),
      eq(pullRequests.provider, params.provider),
      eq(pullRequests.remoteOwner, params.remoteOwner),
      eq(pullRequests.remoteName, params.remoteName),
      eq(pullRequests.number, params.number),
    ),
  });

  if (existingPr) {
    await db
      .update(pullRequests)
      .set({
        title: params.title,
        body: params.body,
        status,
        additions: params.additions ?? existingPr.additions,
        deletions: params.deletions ?? existingPr.deletions,
        changedFiles: params.changedFiles ?? existingPr.changedFiles,
        mergedAt: params.mergedAt ?? existingPr.mergedAt,
        closedAt: params.closedAt ?? existingPr.closedAt,
      })
      .where(eq(pullRequests.id, existingPr.id));

    return existingPr.id;
  }

  const [newPr] = await db
    .insert(pullRequests)
    .values({
      userId: params.userId,
      repositoryId: repo?.id ?? null,
      gitProviderConnectionId: repo?.gitProviderConnectionId ?? null,
      provider: params.provider,
      instanceUrl: params.instanceUrl,
      remoteOwner: params.remoteOwner,
      remoteName: params.remoteName,
      number: params.number,
      headBranch: params.headBranch,
      baseBranch: params.baseBranch,
      title: params.title,
      body: params.body,
      status,
      url: params.url,
      additions: params.additions ?? null,
      deletions: params.deletions ?? null,
      changedFiles: params.changedFiles ?? null,
      mergedAt: params.mergedAt ?? null,
      closedAt: params.closedAt ?? null,
    })
    .returning();

  return newPr!.id;
}
