import "server-only";

import { spawn } from "child_process";

import {
  createProviderClient,
  getConnection,
  listConnections,
} from "@bob/api/services/git/providerConnectionService";

export type GitRepoLike = {
  id: string;
  owner: string;
  name: string;
  fullName: string;
  defaultBranch: string;
  isPrivate: boolean;
  cloneUrl: string;
  htmlUrl: string;
};

export type RepoWithSsh = GitRepoLike & { sshUrl: string };

export type UnifiedRepo = {
  fullName: string;
  preferred: {
    provider: "gitea" | "github";
    instanceUrl: string | null;
    repo: RepoWithSsh;
  };
  sources: {
    gitea?: { instanceUrl: string | null; repo: RepoWithSsh };
    github?: { instanceUrl: string | null; repo: RepoWithSsh };
  };
};

function repoToSshUrl(repo: GitRepoLike): string {
  const raw = repo.cloneUrl;
  if (raw.startsWith("git@") || raw.startsWith("ssh://")) return raw;

  try {
    const u = new URL(raw);
    const host = u.host;
    const pathName = u.pathname.replace(/^\/+/, "");
    const withGit = pathName.endsWith(".git") ? pathName : `${pathName}.git`;
    return `git@${host}:${withGit}`;
  } catch {
    return raw;
  }
}

export function safeRepoDirName(fullName: string): string {
  return fullName.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
}

export async function listUserReposByProvider(
  userId: string,
): Promise<
  Array<{
    provider: "github" | "gitea";
    instanceUrl: string | null;
    repos: GitRepoLike[];
  }>
> {
  const connections = await listConnections(userId);

  const eligible = connections.filter(
    (c) => c.provider === "gitea" || c.provider === "github",
  ) as Array<{ provider: "github" | "gitea"; instanceUrl: string | null }>;

  const results = await Promise.all(
    eligible.map(async (summary) => {
      const conn = await getConnection(
        userId,
        summary.provider,
        summary.instanceUrl,
      );
      if (!conn) {
        return {
          provider: summary.provider,
          instanceUrl: summary.instanceUrl,
          repos: [] as GitRepoLike[],
        };
      }

      const client = createProviderClient(
        summary.provider,
        conn.accessToken,
        conn.instanceUrl ?? undefined,
      );
      const listRepositories = client.listRepositories;
      if (!listRepositories) {
        return {
          provider: summary.provider,
          instanceUrl: summary.instanceUrl,
          repos: [] as GitRepoLike[],
        };
      }

      // Keep this bounded; UI can be scoped later.
      const repos = await listRepositories({ page: 1, perPage: 200 });
      return {
        provider: summary.provider,
        instanceUrl: summary.instanceUrl,
        repos,
      };
    }),
  );

  return results;
}

export async function getUnifiedReposForUser(userId: string): Promise<{
  unified: UnifiedRepo[];
  connections: Array<{
    provider: "github" | "gitea";
    instanceUrl: string | null;
  }>;
}> {
  const byProvider = await listUserReposByProvider(userId);
  const connections = byProvider.map((c) => ({
    provider: c.provider,
    instanceUrl: c.instanceUrl,
  }));

  const byKey = new Map<
    string,
    {
      github?: { instanceUrl: string | null; repo: RepoWithSsh };
      gitea?: { instanceUrl: string | null; repo: RepoWithSsh };
    }
  >();

  for (const chunk of byProvider) {
    for (const r of chunk.repos) {
      const key = `${r.owner}/${r.name}`.toLowerCase();
      const entry = byKey.get(key) ?? {};
      const wrapped = {
        instanceUrl: chunk.instanceUrl,
        repo: { ...r, sshUrl: repoToSshUrl(r) },
      };
      if (chunk.provider === "github") entry.github = wrapped;
      if (chunk.provider === "gitea") entry.gitea = wrapped;
      byKey.set(key, entry);
    }
  }

  const unified: UnifiedRepo[] = [];
  for (const sources of byKey.values()) {
    const preferredProvider: "gitea" | "github" = sources.gitea
      ? "gitea"
      : "github";
    const preferred = sources[preferredProvider];
    if (!preferred) continue;

    unified.push({
      fullName: preferred.repo.fullName,
      preferred: {
        provider: preferredProvider,
        instanceUrl: preferred.instanceUrl,
        repo: preferred.repo,
      },
      sources,
    });
  }

  unified.sort((a, b) => a.fullName.localeCompare(b.fullName));
  return { unified, connections };
}

export function runGit(args: string[], cwd?: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn("git", args, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stderr = "";
    child.stderr.on("data", (d) => (stderr += d.toString()));
    child.on("error", (err) =>
      reject(new Error(`Failed to spawn git: ${err.message}`)),
    );
    child.on("close", (code) => {
      if (code === 0) return resolve();
      reject(
        new Error(`git ${args[0] ?? ""} failed (code ${code}): ${stderr}`),
      );
    });
  });
}
