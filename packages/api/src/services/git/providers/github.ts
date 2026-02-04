import type {
  CreatePullRequestInput,
  GitBranch,
  GitCommit,
  GitProviderClient,
  GitPullRequest,
  GitRepository,
  GitUser,
  ListRepositoriesInput,
  UpdatePullRequestInput,
} from "./types";

const GITHUB_API = "https://api.github.com";

export function createGitHubClient(accessToken: string): GitProviderClient {
  async function request<T>(
    endpoint: string,
    options: RequestInit = {},
  ): Promise<T> {
    const response = await fetch(`${GITHUB_API}${endpoint}`, {
      ...options,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/vnd.github.v3+json",
        "Content-Type": "application/json",
        ...options.headers,
      },
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`GitHub API error (${response.status}): ${error}`);
    }

    return response.json() as Promise<T>;
  }

  return {
    provider: "github",

    async listRepositories(
      input: ListRepositoriesInput,
    ): Promise<GitRepository[]> {
      const repos = await request<
        Array<{
          id: number;
          owner: { login: string };
          name: string;
          full_name: string;
          default_branch: string;
          private: boolean;
          clone_url: string;
          html_url: string;
        }>
      >(
        `/user/repos?per_page=${input.perPage}&page=${input.page}&sort=updated`,
      );

      return repos.map((repository) => ({
        id: String(repository.id),
        owner: repository.owner.login,
        name: repository.name,
        fullName: repository.full_name,
        defaultBranch: repository.default_branch,
        isPrivate: repository.private,
        cloneUrl: repository.clone_url,
        htmlUrl: repository.html_url,
      }));
    },

    async getAuthenticatedUser(): Promise<GitUser> {
      const user = await request<{
        id: number;
        login: string;
        email: string | null;
        name: string | null;
        avatar_url: string;
      }>("/user");

      return {
        id: String(user.id),
        username: user.login,
        email: user.email ?? undefined,
        name: user.name ?? undefined,
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
          commit: { sha: string };
          protected: boolean;
        }>
      >(`/repos/${owner}/${repo}/branches`);

      return branches.map((b) => ({
        name: b.name,
        sha: b.commit.sha,
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
      >(`/repos/${owner}/${repo}/commits?sha=${branch}&per_page=${limit}`);

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
      const pr = await request<{
        id: number;
        number: number;
        title: string;
        body: string | null;
        state: string;
        draft: boolean;
        head: { ref: string };
        base: { ref: string };
        html_url: string;
        additions: number;
        deletions: number;
        changed_files: number;
        created_at: string;
        updated_at: string;
        merged_at: string | null;
        closed_at: string | null;
      }>(`/repos/${input.owner}/${input.repo}/pulls`, {
        method: "POST",
        body: JSON.stringify({
          title: input.title,
          body: input.body,
          head: input.head,
          base: input.base,
          draft: input.draft ?? false,
        }),
      });

      return mapPullRequest(pr);
    },

    async getPullRequest(
      owner: string,
      repo: string,
      number: number,
    ): Promise<GitPullRequest> {
      const pr = await request<GitHubPR>(
        `/repos/${owner}/${repo}/pulls/${number}`,
      );
      return mapPullRequest(pr);
    },

    async updatePullRequest(
      input: UpdatePullRequestInput,
    ): Promise<GitPullRequest> {
      const pr = await request<GitHubPR>(
        `/repos/${input.owner}/${input.repo}/pulls/${input.number}`,
        {
          method: "PATCH",
          body: JSON.stringify({
            title: input.title,
            body: input.body,
            state: input.state,
          }),
        },
      );

      return mapPullRequest(pr);
    },

    async mergePullRequest(
      owner: string,
      repo: string,
      number: number,
      mergeMethod: "merge" | "squash" | "rebase" = "squash",
    ): Promise<void> {
      await request(`/repos/${owner}/${repo}/pulls/${number}/merge`, {
        method: "PUT",
        body: JSON.stringify({ merge_method: mergeMethod }),
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

interface GitHubPR {
  id: number;
  number: number;
  title: string;
  body: string | null;
  state: string;
  draft: boolean;
  head: { ref: string };
  base: { ref: string };
  html_url: string;
  additions?: number;
  deletions?: number;
  changed_files?: number;
  created_at: string;
  updated_at: string;
  merged_at: string | null;
  closed_at: string | null;
}

function mapPullRequest(pr: GitHubPR): GitPullRequest {
  let state: "open" | "closed" | "merged" = "open";
  if (pr.merged_at) {
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
    draft: pr.draft,
    headBranch: pr.head.ref,
    baseBranch: pr.base.ref,
    url: pr.html_url,
    additions: pr.additions,
    deletions: pr.deletions,
    changedFiles: pr.changed_files,
    createdAt: new Date(pr.created_at),
    updatedAt: new Date(pr.updated_at),
    mergedAt: pr.merged_at ? new Date(pr.merged_at) : null,
    closedAt: pr.closed_at ? new Date(pr.closed_at) : null,
  };
}
