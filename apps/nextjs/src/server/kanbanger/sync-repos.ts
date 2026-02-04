import "server-only";

import { spawn } from "child_process";
import { existsSync, mkdirSync } from "fs";
import os from "os";
import path from "path";

import {
  createProviderClient,
  getConnection,
  listConnections,
} from "@bob/api/services/git/providerConnectionService";
import { eq } from "@bob/db";
import { db } from "@bob/db/client";
import { repositories, user } from "@bob/db/schema";

import { getServices } from "~/server/services";

const KANBANGER_URL = process.env.KANBANGER_URL ?? "https://tasks.gmac.io";
const KANBANGER_API_KEY = process.env.KANBANGER_API_KEY;

interface KanbangerProjectListItem {
  project: {
    id: string;
    name: string;
    key: string;
  };
}

async function kanbangerRequest<T>(path: string, input: unknown): Promise<T> {
  if (!KANBANGER_API_KEY) {
    throw new Error("KANBANGER_API_KEY not configured");
  }

  // tasks.gmac.io (Kanbanger) rejects POST for query procedures; use GET batch format.
  const inputObj = { "0": { json: input ?? {} } };
  const qs = new URLSearchParams({
    batch: "1",
    input: JSON.stringify(inputObj),
  });

  const url = `${KANBANGER_URL}/api/trpc/${path}?${qs.toString()}`;
  const response = await fetch(url, {
    method: "GET",
    headers: {
      "X-API-Key": KANBANGER_API_KEY,
    },
  });

  if (!response.ok) {
    throw new Error(`Kanbanger API error: ${await response.text()}`);
  }

  const result = (await response.json()) as Array<{
    result?: { data?: { json?: T } };
    error?: { message?: string };
  }>;

  if (result[0]?.error) {
    throw new Error(result[0].error.message ?? "Kanbanger error");
  }

  return result[0]?.result?.data?.json as T;
}

function safeRepoDirName(fullName: string): string {
  return fullName.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
}

function runGit(args: string[], cwd?: string): Promise<void> {
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

function normalizeName(input: string): string {
  return input.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

type GitRepoLike = {
  id: string;
  owner: string;
  name: string;
  fullName: string;
  defaultBranch: string;
  isPrivate: boolean;
  cloneUrl: string;
  htmlUrl: string;
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

type RepoWithSsh = GitRepoLike & { sshUrl: string };

type UnifiedRepo = {
  fullName: string;
  preferred: {
    provider: "gitea" | "github";
    repo: RepoWithSsh;
  };
  sources: {
    gitea?: RepoWithSsh;
    github?: RepoWithSsh;
  };
};

function mergeByOwnerNamePreferGitea(input: {
  github: GitRepoLike[];
  gitea: GitRepoLike[];
}): UnifiedRepo[] {
  const byKey = new Map<
    string,
    { github?: RepoWithSsh; gitea?: RepoWithSsh }
  >();

  for (const r of input.github) {
    const key = `${r.owner}/${r.name}`.toLowerCase();
    const entry = byKey.get(key) ?? {};
    entry.github = { ...r, sshUrl: repoToSshUrl(r) };
    byKey.set(key, entry);
  }

  for (const r of input.gitea) {
    const key = `${r.owner}/${r.name}`.toLowerCase();
    const entry = byKey.get(key) ?? {};
    entry.gitea = { ...r, sshUrl: repoToSshUrl(r) };
    byKey.set(key, entry);
  }

  return Array.from(byKey.values())
    .map((sources) => {
      const preferredProvider = sources.gitea ? "gitea" : "github";
      const preferred = sources[preferredProvider];
      if (!preferred) return null;
      return {
        fullName: preferred.fullName,
        preferred: { provider: preferredProvider, repo: preferred },
        sources,
      } satisfies UnifiedRepo;
    })
    .filter((r): r is UnifiedRepo => r !== null)
    .sort((a, b) => a.fullName.localeCompare(b.fullName));
}

function pickMatchingRepo(projectName: string, unifiedRepos: UnifiedRepo[]) {
  const pn = normalizeName(projectName);
  if (!pn) return null;

  // Prefer exact normalized name match.
  const exact = unifiedRepos.find(
    (r) => normalizeName(r.preferred.repo.name) === pn,
  );
  if (exact) return exact;

  // Next, allow containment (handles e.g. "Control Panel Demo" vs "control-panel").
  const contains = unifiedRepos.find((r) => {
    const rn = normalizeName(r.preferred.repo.name);
    return rn.includes(pn) || pn.includes(rn);
  });
  return contains ?? null;
}

export type KanbangerSyncReposResult = {
  workspaceId: string;
  userId: string;
  projects: number;
  cloned: number;
  skipped: number;
  unmatched: number;
  errors: number;
  results: Array<{
    projectId: string;
    projectName: string;
    status: "matched" | "unmatched" | "cloned" | "skipped" | "error";
    repoFullName?: string;
    error?: string;
  }>;
};

export async function syncKanbangerReposForBobUser(input: {
  workspaceId?: string | null;
  userId?: string | null;
}): Promise<KanbangerSyncReposResult> {
  if (!KANBANGER_API_KEY) {
    const err = new Error("KANBANGER_API_KEY not configured");
    (err as any).statusCode = 412;
    throw err;
  }

  const targetUser = input.userId
    ? await db.query.user.findFirst({ where: eq(user.id, input.userId) })
    : await db.query.user.findFirst();

  if (!targetUser) {
    throw new Error("No users found");
  }

  const resolvedWorkspaceId = input.workspaceId
    ? input.workspaceId
    : (() => {
        // workspace.list returns memberships (workspace nested) on tasks.gmac.io.
        const first = (ws: any) => ws?.[0];
        return kanbangerRequest<any[]>("workspace.list", {}).then((ws) => {
          const item = first(ws);
          return item?.id ?? item?.workspace?.id;
        });
      })();

  const workspaceIdValue = await resolvedWorkspaceId;

  if (!workspaceIdValue) {
    throw new Error("No Kanbanger workspace found");
  }

  const projects = await kanbangerRequest<KanbangerProjectListItem[]>(
    "project.list",
    {
      workspaceId: workspaceIdValue,
    },
  );

  const connections = await listConnections(targetUser.id);
  const reposByProvider = await Promise.all(
    connections
      .filter((c) => c.provider === "gitea" || c.provider === "github")
      .map(async (summary) => {
        const provider = summary.provider as "github" | "gitea";
        const conn = await getConnection(
          targetUser.id,
          provider,
          summary.instanceUrl,
        );
        if (!conn) return { provider, repos: [] as GitRepoLike[] };

        const client = createProviderClient(
          provider,
          conn.accessToken,
          conn.instanceUrl ?? undefined,
        );

        const listRepositories = client.listRepositories;
        if (!listRepositories) {
          return { provider, repos: [] as GitRepoLike[] };
        }

        const repos = await listRepositories({ page: 1, perPage: 100 });
        return { provider, repos };
      }),
  );

  const githubRepos = reposByProvider
    .filter((r) => r.provider === "github")
    .flatMap((r) => r.repos);
  const giteaRepos = reposByProvider
    .filter((r) => r.provider === "gitea")
    .flatMap((r) => r.repos);

  const merged = mergeByOwnerNamePreferGitea({
    github: githubRepos,
    gitea: giteaRepos,
  });

  const { gitService } = await getServices();
  const reposDir =
    process.env.BOB_REPOS_DIR || path.join(os.homedir(), "bob-repos");
  if (!existsSync(reposDir)) mkdirSync(reposDir, { recursive: true });

  const results: KanbangerSyncReposResult["results"] = [];

  for (const p of projects) {
    const match = pickMatchingRepo(p.project.name, merged);
    if (!match) {
      results.push({
        projectId: p.project.id,
        projectName: p.project.name,
        status: "unmatched",
      });
      continue;
    }

    const preferred = match.preferred.repo;
    const dirName = safeRepoDirName(preferred.fullName);
    const clonePath = path.join(reposDir, dirName);

    try {
      const existingByPath = await db.query.repositories.findFirst({
        where: eq(repositories.path, clonePath),
      });

      if (existingByPath) {
        results.push({
          projectId: p.project.id,
          projectName: p.project.name,
          status: "skipped",
          repoFullName: preferred.fullName,
        });
        continue;
      }

      if (!existsSync(clonePath)) {
        await runGit(["clone", "--", preferred.sshUrl, clonePath]);
      }

      await gitService.addRepository(clonePath, targetUser.id);

      results.push({
        projectId: p.project.id,
        projectName: p.project.name,
        status: "cloned",
        repoFullName: preferred.fullName,
      });
    } catch (error) {
      results.push({
        projectId: p.project.id,
        projectName: p.project.name,
        status: "error",
        repoFullName: preferred.fullName,
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }

  const cloned = results.filter((r) => r.status === "cloned").length;
  const skipped = results.filter((r) => r.status === "skipped").length;
  const unmatched = results.filter((r) => r.status === "unmatched").length;
  const errors = results.filter((r) => r.status === "error").length;

  return {
    workspaceId: workspaceIdValue,
    userId: targetUser.id,
    projects: projects.length,
    cloned,
    skipped,
    unmatched,
    errors,
    results,
  };
}
