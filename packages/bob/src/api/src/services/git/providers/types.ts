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

export interface ListRepositoriesInput {
  page: number;
  perPage: number;
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
  headSha?: string;
  /** Provider's mergeability check; undefined if the provider didn't report it. */
  mergeable?: boolean;
  url: string;
  additions?: number;
  deletions?: number;
  changedFiles?: number;
  createdAt: Date;
  updatedAt: Date;
  mergedAt: Date | null;
  closedAt: Date | null;
}

/** Combined CI/commit status for a SHA. `state` follows the provider's
 * combined-status vocabulary ("success" | "pending" | "failure" | "error"). */
export interface CommitStatus {
  state: string;
  total: number;
}

/** A submitted PR review, used to detect whether we've already reviewed the
 * current head (so the reaper doesn't re-review every tick). */
export interface PullRequestReview {
  state: string; // "APPROVED" | "REQUEST_CHANGES" | "COMMENT" | "PENDING"
  commitId: string | null;
  userLogin: string | null;
}

export type ReviewEvent = "APPROVE" | "REQUEST_CHANGES" | "COMMENT";

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

  // Optional because not all providers are implemented yet.
  listRepositories?: (input: ListRepositoriesInput) => Promise<GitRepository[]>;

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

  // ── Optional: review/auto-merge support ─────────────────────────────
  // Implemented for gitea (Forgejo); other providers may omit them and the
  // auto-merge reaper simply skips PRs on providers that don't support them.

  /** Combined CI status for a commit SHA. */
  getCommitStatus?: (
    owner: string,
    repo: string,
    sha: string,
  ) => Promise<CommitStatus>;

  /** Raw unified diff for a PR. */
  getPullRequestDiff?: (
    owner: string,
    repo: string,
    number: number,
  ) => Promise<string>;

  /** Existing reviews on a PR (to detect an already-submitted verdict). */
  listPullRequestReviews?: (
    owner: string,
    repo: string,
    number: number,
  ) => Promise<PullRequestReview[]>;

  /** Submit a review verdict on a PR. */
  createPullRequestReview?: (
    owner: string,
    repo: string,
    number: number,
    event: ReviewEvent,
    body: string,
  ) => Promise<void>;
}
