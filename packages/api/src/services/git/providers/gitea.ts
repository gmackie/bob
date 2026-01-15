import type {
  CreatePullRequestInput,
  GitBranch,
  GitCommit,
  GitProviderClient,
  GitPullRequest,
  GitRepository,
  GitUser,
  UpdatePullRequestInput,
} from "./types";

export function createGiteaClient(
  accessToken: string,
  instanceUrl: string,
): GitProviderClient {
  const apiBase = `${instanceUrl}/api/v1`;

  async function request<T>(
    endpoint: string,
    options: RequestInit = {},
  ): Promise<T> {
    const response = await fetch(`${apiBase}${endpoint}`, {
      ...options,
      headers: {
        Authorization: `token ${accessToken}`,
        "Content-Type": "application/json",
        ...options.headers,
      },
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Gitea API error (${response.status}): ${error}`);
    }

    return response.json() as Promise<T>;
  }

  return {
    provider: "gitea",

    async getAuthenticatedUser(): Promise<GitUser> {
      const user = await request<{
        id: number;
        login: string;
        email: string;
        full_name: string;
        avatar_url: string;
      }>("/user");

      return {
        id: String(user.id),
        username: user.login,
        email: user.email,
        name: user.full_name || undefined,
        avatarUrl: user.avatar_url,
      };
    },

    async getRepository(owner: string, repo: string): Promise<GitRepository> {
      const repository = await request<{
        id: number;
        owner: { login: string };
        name: string;
        full_name: string;
        default_branch: string;
        private: boolean;
        clone_url: string;
        html_url: string;
      }>(`/repos/${owner}/${repo}`);

      return {
        id: String(repository.id),
        owner: repository.owner.login,
        name: repository.name,
        fullName: repository.full_name,
        defaultBranch: repository.default_branch,
        isPrivate: repository.private,
        cloneUrl: repository.clone_url,
        htmlUrl: repository.html_url,
      };
    },

    async listBranches(owner: string, repo: string): Promise<GitBranch[]> {
      const branches = await request<
        Array<{
          name: string;
          commit: { id: string };
          protected: boolean;
        }>
      >(`/repos/${owner}/${repo}/branches`);

      return branches.map((b) => ({
        name: b.name,
        sha: b.commit.id,
        protected: b.protected,
      }));
    },

    async listCommits(
      owner: string,
      repo: string,
      branch: string,
      limit = 30,
    ): Promise<GitCommit[]> {
      const commits = await request<
        Array<{
          sha: string;
          commit: {
            message: string;
            author: { name: string; email: string; date: string };
          };
          html_url: string;
        }>
      >(`/repos/${owner}/${repo}/commits?sha=${branch}&limit=${limit}`);

      return commits.map((c) => ({
        sha: c.sha,
        message: c.commit.message,
        authorName: c.commit.author.name,
        authorEmail: c.commit.author.email,
        committedAt: new Date(c.commit.author.date),
        url: c.html_url,
      }));
    },

    async createPullRequest(
      input: CreatePullRequestInput,
    ): Promise<GitPullRequest> {
      const pr = await request<GiteaPR>(
        `/repos/${input.owner}/${input.repo}/pulls`,
        {
          method: "POST",
          body: JSON.stringify({
            title: input.title,
            body: input.body,
            head: input.head,
            base: input.base,
          }),
        },
      );

      return mapPullRequest(pr, instanceUrl);
    },

    async getPullRequest(
      owner: string,
      repo: string,
      number: number,
    ): Promise<GitPullRequest> {
      const pr = await request<GiteaPR>(
        `/repos/${owner}/${repo}/pulls/${number}`,
      );
      return mapPullRequest(pr, instanceUrl);
    },

    async updatePullRequest(
      input: UpdatePullRequestInput,
    ): Promise<GitPullRequest> {
      const body: Record<string, unknown> = {};
      if (input.title) body.title = input.title;
      if (input.body !== undefined) body.body = input.body;
      if (input.state) body.state = input.state;

      const pr = await request<GiteaPR>(
        `/repos/${input.owner}/${input.repo}/pulls/${input.number}`,
        {
          method: "PATCH",
          body: JSON.stringify(body),
        },
      );

      return mapPullRequest(pr, instanceUrl);
    },

    async mergePullRequest(
      owner: string,
      repo: string,
      number: number,
      mergeMethod: "merge" | "squash" | "rebase" = "squash",
    ): Promise<void> {
      const doMap: Record<string, string> = {
        merge: "merge",
        squash: "squash",
        rebase: "rebase-merge",
      };

      await request(`/repos/${owner}/${repo}/pulls/${number}/merge`, {
        method: "POST",
        body: JSON.stringify({
          Do: doMap[mergeMethod],
          delete_branch_after_merge: true,
        }),
      });
    },

    async listPullRequestCommits(
      owner: string,
      repo: string,
      number: number,
    ): Promise<GitCommit[]> {
      const commits = await request<
        Array<{
          sha: string;
          commit: {
            message: string;
            author: { name: string; email: string; date: string };
          };
          html_url: string;
        }>
      >(`/repos/${owner}/${repo}/pulls/${number}/commits`);

      return commits.map((c) => ({
        sha: c.sha,
        message: c.commit.message,
        authorName: c.commit.author.name,
        authorEmail: c.commit.author.email,
        committedAt: new Date(c.commit.author.date),
        url: c.html_url,
      }));
    },
  };
}

interface GiteaPR {
  id: number;
  number: number;
  title: string;
  body: string;
  state: string;
  head: { ref: string };
  base: { ref: string; repo: { full_name: string } };
  additions?: number;
  deletions?: number;
  changed_files?: number;
  created_at: string;
  updated_at: string;
  merged_at: string | null;
  closed_at: string | null;
  merged: boolean;
}

function mapPullRequest(pr: GiteaPR, instanceUrl: string): GitPullRequest {
  let state: "open" | "closed" | "merged" = "open";
  if (pr.merged) {
    state = "merged";
  } else if (pr.state === "closed") {
    state = "closed";
  }

  return {
    id: pr.id,
    number: pr.number,
    title: pr.title,
    body: pr.body,
    state,
    draft: false,
    headBranch: pr.head.ref,
    baseBranch: pr.base.ref,
    url: `${instanceUrl}/${pr.base.repo.full_name}/pulls/${pr.number}`,
    additions: pr.additions,
    deletions: pr.deletions,
    changedFiles: pr.changed_files,
    createdAt: new Date(pr.created_at),
    updatedAt: new Date(pr.updated_at),
    mergedAt: pr.merged_at ? new Date(pr.merged_at) : null,
    closedAt: pr.closed_at ? new Date(pr.closed_at) : null,
  };
}
