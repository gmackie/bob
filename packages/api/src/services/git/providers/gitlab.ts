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

const GITLAB_API_DEFAULT = "https://gitlab.com/api/v4";

export function createGitLabClient(
  accessToken: string,
  instanceUrl?: string,
): GitProviderClient {
  const apiBase = instanceUrl ? `${instanceUrl}/api/v4` : GITLAB_API_DEFAULT;

  async function request<T>(
    endpoint: string,
    options: RequestInit = {},
  ): Promise<T> {
    const response = await fetch(`${apiBase}${endpoint}`, {
      ...options,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        ...options.headers,
      },
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`GitLab API error (${response.status}): ${error}`);
    }

    return response.json() as Promise<T>;
  }

  function encodeProject(owner: string, repo: string): string {
    return encodeURIComponent(`${owner}/${repo}`);
  }

  return {
    provider: "gitlab",

    async getAuthenticatedUser(): Promise<GitUser> {
      const user = await request<{
        id: number;
        username: string;
        email: string;
        name: string;
        avatar_url: string;
      }>("/user");

      return {
        id: String(user.id),
        username: user.username,
        email: user.email,
        name: user.name,
        avatarUrl: user.avatar_url,
      };
    },

    async getRepository(owner: string, repo: string): Promise<GitRepository> {
      const project = await request<{
        id: number;
        namespace: { path: string };
        path: string;
        path_with_namespace: string;
        default_branch: string;
        visibility: string;
        http_url_to_repo: string;
        web_url: string;
      }>(`/projects/${encodeProject(owner, repo)}`);

      return {
        id: String(project.id),
        owner: project.namespace.path,
        name: project.path,
        fullName: project.path_with_namespace,
        defaultBranch: project.default_branch,
        isPrivate: project.visibility === "private",
        cloneUrl: project.http_url_to_repo,
        htmlUrl: project.web_url,
      };
    },

    async listBranches(owner: string, repo: string): Promise<GitBranch[]> {
      const branches = await request<
        Array<{
          name: string;
          commit: { id: string };
          protected: boolean;
        }>
      >(`/projects/${encodeProject(owner, repo)}/repository/branches`);

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
          id: string;
          message: string;
          author_name: string;
          author_email: string;
          committed_date: string;
          web_url: string;
        }>
      >(
        `/projects/${encodeProject(owner, repo)}/repository/commits?ref_name=${branch}&per_page=${limit}`,
      );

      return commits.map((c) => ({
        sha: c.id,
        message: c.message,
        authorName: c.author_name,
        authorEmail: c.author_email,
        committedAt: new Date(c.committed_date),
        url: c.web_url,
      }));
    },

    async createPullRequest(
      input: CreatePullRequestInput,
    ): Promise<GitPullRequest> {
      const mr = await request<GitLabMR>(
        `/projects/${encodeProject(input.owner, input.repo)}/merge_requests`,
        {
          method: "POST",
          body: JSON.stringify({
            title: input.title,
            description: input.body,
            source_branch: input.head,
            target_branch: input.base,
            draft: input.draft ?? false,
          }),
        },
      );

      return mapMergeRequest(mr);
    },

    async getPullRequest(
      owner: string,
      repo: string,
      number: number,
    ): Promise<GitPullRequest> {
      const mr = await request<GitLabMR>(
        `/projects/${encodeProject(owner, repo)}/merge_requests/${number}`,
      );
      return mapMergeRequest(mr);
    },

    async updatePullRequest(
      input: UpdatePullRequestInput,
    ): Promise<GitPullRequest> {
      const body: Record<string, unknown> = {};
      if (input.title) body.title = input.title;
      if (input.body !== undefined) body.description = input.body;
      if (input.state)
        body.state_event = input.state === "closed" ? "close" : "reopen";

      const mr = await request<GitLabMR>(
        `/projects/${encodeProject(input.owner, input.repo)}/merge_requests/${input.number}`,
        {
          method: "PUT",
          body: JSON.stringify(body),
        },
      );

      return mapMergeRequest(mr);
    },

    async mergePullRequest(
      owner: string,
      repo: string,
      number: number,
      mergeMethod: "merge" | "squash" | "rebase" = "squash",
    ): Promise<void> {
      await request(
        `/projects/${encodeProject(owner, repo)}/merge_requests/${number}/merge`,
        {
          method: "PUT",
          body: JSON.stringify({
            squash: mergeMethod === "squash",
            should_remove_source_branch: true,
          }),
        },
      );
    },

    async listPullRequestCommits(
      owner: string,
      repo: string,
      number: number,
    ): Promise<GitCommit[]> {
      const commits = await request<
        Array<{
          id: string;
          message: string;
          author_name: string;
          author_email: string;
          committed_date: string;
          web_url: string;
        }>
      >(
        `/projects/${encodeProject(owner, repo)}/merge_requests/${number}/commits`,
      );

      return commits.map((c) => ({
        sha: c.id,
        message: c.message,
        authorName: c.author_name,
        authorEmail: c.author_email,
        committedAt: new Date(c.committed_date),
        url: c.web_url,
      }));
    },
  };
}

interface GitLabMR {
  id: number;
  iid: number;
  title: string;
  description: string | null;
  state: string;
  draft: boolean;
  source_branch: string;
  target_branch: string;
  web_url: string;
  changes_count?: string;
  created_at: string;
  updated_at: string;
  merged_at: string | null;
  closed_at: string | null;
}

function mapMergeRequest(mr: GitLabMR): GitPullRequest {
  let state: "open" | "closed" | "merged" = "open";
  if (mr.state === "merged") {
    state = "merged";
  } else if (mr.state === "closed") {
    state = "closed";
  }

  return {
    id: mr.id,
    number: mr.iid,
    title: mr.title,
    body: mr.description,
    state,
    draft: mr.draft,
    headBranch: mr.source_branch,
    baseBranch: mr.target_branch,
    url: mr.web_url,
    changedFiles: mr.changes_count ? parseInt(mr.changes_count, 10) : undefined,
    createdAt: new Date(mr.created_at),
    updatedAt: new Date(mr.updated_at),
    mergedAt: mr.merged_at ? new Date(mr.merged_at) : null,
    closedAt: mr.closed_at ? new Date(mr.closed_at) : null,
  };
}
