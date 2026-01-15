export type GitProvider = "github" | "gitlab" | "gitea";

export interface GitUser {
  id: string;
  username: string;
  email?: string;
  name?: string;
  avatarUrl?: string;
}

export interface GitRepository {
  id: string;
  owner: string;
  name: string;
  fullName: string;
  defaultBranch: string;
  isPrivate: boolean;
  cloneUrl: string;
  htmlUrl: string;
}

export interface GitBranch {
  name: string;
  sha: string;
  protected: boolean;
}

export interface GitCommit {
  sha: string;
  message: string;
  authorName: string;
  authorEmail: string;
  committedAt: Date;
  url: string;
}

export interface GitPullRequest {
  id: number;
  number: number;
  title: string;
  body: string | null;
  state: "open" | "closed" | "merged";
  draft: boolean;
  headBranch: string;
  baseBranch: string;
  url: string;
  additions?: number;
  deletions?: number;
  changedFiles?: number;
  createdAt: Date;
  updatedAt: Date;
  mergedAt: Date | null;
  closedAt: Date | null;
}

export interface CreatePullRequestInput {
  owner: string;
  repo: string;
  title: string;
  body?: string;
  head: string;
  base: string;
  draft?: boolean;
}

export interface UpdatePullRequestInput {
  owner: string;
  repo: string;
  number: number;
  title?: string;
  body?: string;
  state?: "open" | "closed";
}

export interface GitProviderClient {
  provider: GitProvider;

  getAuthenticatedUser(): Promise<GitUser>;

  getRepository(owner: string, repo: string): Promise<GitRepository>;

  listBranches(owner: string, repo: string): Promise<GitBranch[]>;

  listCommits(
    owner: string,
    repo: string,
    branch: string,
    limit?: number,
  ): Promise<GitCommit[]>;

  createPullRequest(input: CreatePullRequestInput): Promise<GitPullRequest>;

  getPullRequest(
    owner: string,
    repo: string,
    number: number,
  ): Promise<GitPullRequest>;

  updatePullRequest(input: UpdatePullRequestInput): Promise<GitPullRequest>;

  mergePullRequest(
    owner: string,
    repo: string,
    number: number,
    mergeMethod?: "merge" | "squash" | "rebase",
  ): Promise<void>;

  listPullRequestCommits(
    owner: string,
    repo: string,
    number: number,
  ): Promise<GitCommit[]>;
}
