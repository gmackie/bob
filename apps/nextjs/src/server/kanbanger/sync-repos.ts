import "server-only";

import { spawn } from "child_process";
import { existsSync, mkdirSync, readdirSync, statSync } from "fs";
import os from "os";
import path from "path";

import {
  createProviderClient,
  getConnection,
  listConnections,
} from "@bob/api/services/git/providerConnectionService";
import { and, eq, isNotNull, ne } from "@bob/db";
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

const COMMON_OWNER_PREFIXES = ["gmackie-", "gmac-"];

const DEMOISH_RE = /\b(demo|example|sample|playground|sandbox|test)\b/i;

const STOP_TOKENS = new Set([
  "app",
  "service",
  "api",
  "backend",
  "frontend",
  "client",
  "server",
  "web",
  "mobile",
  "core",
  "lib",
  "libs",
  "pkg",
  "package",
  "repo",
  "project",
]);

function stripCommonPrefixes(name: string): string {
  const lower = name.toLowerCase();
  for (const p of COMMON_OWNER_PREFIXES) {
    if (lower.startsWith(p)) return name.slice(p.length);
  }
  return name;
}

function normalizeLoose(input: string): string {
  return input.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function normalizeSpaced(input: string): string {
  return input
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function tokenSet(input: string): Set<string> {
  const spaced = normalizeSpaced(input);
  if (!spaced) return new Set();

  const out = new Set<string>();
  for (const t of spaced.split(" ")) {
    if (!t) continue;
    if (STOP_TOKENS.has(t)) continue;
    out.add(t);
  }

  // Include compact form to help acronym-ish tokens overlap (e.g. LZRTag -> lzrtag)
  const compact = spaced.replace(/\s+/g, "");
  if (compact.length >= 4 && !STOP_TOKENS.has(compact)) out.add(compact);

  return out;
}

function tokenWeight(token: string): number {
  if (token.length <= 2) return 0.2;
  if (token.length <= 4) return 0.7;
  return 1;
}

function weightedJaccard(a: Set<string>, b: Set<string>): number {
  let inter = 0;
  let uni = 0;
  const all = new Set([...a, ...b]);
  for (const t of all) {
    const w = tokenWeight(t);
    const inA = a.has(t);
    const inB = b.has(t);
    if (inA || inB) uni += w;
    if (inA && inB) inter += w;
  }
  return uni > 0 ? inter / uni : 0;
}

function acronymCompact(input: string): string {
  // Covers: LZRTag, Foo Bar, foo-bar
  const spaced = normalizeSpaced(input);
  const words = spaced ? spaced.split(" ") : [];
  const initials = words.map((w) => w[0] ?? "").join("");
  const upperRuns = (input.match(/[A-Z]{2,}/g) ?? []).join("");
  return normalizeLoose(`${upperRuns} ${initials} ${input}`);
}

function projectNameWithoutDemo(name: string): string {
  return name
    .replace(/\bdemo\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function scoreRepoMatch(input: {
  projectKey: string;
  projectName: string;
  repoSlugCandidates: string[];
  repoFullNameCandidates: string[];
}): number {
  const keyRaw = input.projectKey.trim();
  const nameRaw = projectNameWithoutDemo(input.projectName);
  const keyN = normalizeLoose(keyRaw);
  const nameN = normalizeLoose(nameRaw);
  if (!keyN && !nameN) return 0;

  const projectTokens = tokenSet(`${keyRaw} ${nameRaw}`);
  const keyAcr = acronymCompact(keyRaw);
  const nameAcr = acronymCompact(nameRaw);

  const slugs = input.repoSlugCandidates
    .filter(Boolean)
    .flatMap((s) => [s, stripCommonPrefixes(s)])
    .map((s) => s.trim())
    .filter(Boolean);

  const fulls = input.repoFullNameCandidates
    .filter(Boolean)
    .map((s) => s.trim())
    .filter(Boolean);

  let best = 0;

  const projectWantsDemoish = DEMOISH_RE.test(input.projectName);

  for (const raw of slugs) {
    const sLoose = normalizeLoose(raw);
    if (!sLoose) continue;

    const strippedLoose = normalizeLoose(stripCommonPrefixes(raw));
    const repoTokens = tokenSet(raw);
    const overlap = weightedJaccard(projectTokens, repoTokens);

    const prefix =
      (keyN && strippedLoose.startsWith(keyN)) ||
      (nameN && strippedLoose.startsWith(nameN))
        ? 1
        : 0;

    const acronymHit =
      (keyAcr && strippedLoose.includes(keyAcr)) ||
      (nameAcr && strippedLoose.includes(nameAcr))
        ? 1
        : 0;

    // Key matches are frequently low-signal (short keys). Use them mainly as a boost
    // when they are exact/prefix matches.
    const keyIsShort = keyN.length > 0 && keyN.length <= 4;
    let keyScore = 0;
    if (keyN && strippedLoose === keyN) keyScore = 1;
    else if (keyN && strippedLoose.startsWith(keyN)) keyScore = 0.7;
    else if (!keyIsShort && keyN && strippedLoose.includes(keyN))
      keyScore = 0.35;

    let nameScore = 0;
    if (nameN && strippedLoose === nameN) nameScore = 1;
    else if (nameN && strippedLoose.startsWith(nameN)) nameScore = 0.75;
    else if (nameN && strippedLoose.includes(nameN)) nameScore = 0.5;

    let score =
      100 *
        (0.55 * overlap +
          0.25 * prefix +
          0.15 * acronymHit +
          0.05 * nameScore) +
      35 * keyScore;

    if (!projectWantsDemoish && DEMOISH_RE.test(raw)) score -= 20;

    best = Math.max(best, Math.round(score));
  }

  for (const raw of fulls) {
    const fLoose = normalizeLoose(raw);
    if (!fLoose) continue;
    const overlap = weightedJaccard(projectTokens, tokenSet(raw));
    if (overlap > 0) best = Math.max(best, Math.round(25 + overlap * 30));
    if (keyN && fLoose.includes(keyN)) best = Math.max(best, 35);
    if (nameN && fLoose.includes(nameN)) best = Math.max(best, 30);
  }

  return best;
}

type Scored<T> = { item: T; score: number };

function pickBestByScore<T>(
  scored: Array<Scored<T>>,
  options?: { minScore?: number; minDelta?: number },
): { best: T | null; bestScore: number; ambiguous: boolean } {
  const minScore = options?.minScore ?? 55;
  const minDelta = options?.minDelta ?? 8;
  const sorted = scored
    .filter((x) => Number.isFinite(x.score))
    .sort((a, b) => b.score - a.score);
  const top = sorted[0];
  if (!top || top.score < minScore)
    return { best: null, bestScore: 0, ambiguous: false };
  const second = sorted[1];
  if (second && top.score - second.score < minDelta) {
    return { best: null, bestScore: top.score, ambiguous: true };
  }
  return { best: top.item, bestScore: top.score, ambiguous: false };
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
  return normalizeLoose(input);
}

type LocalRepo = {
  path: string;
  dirName: string;
  remoteUrl: string | null;
  remoteFullName: string | null;
};

async function getGitRemoteUrl(repoPath: string): Promise<string | null> {
  return new Promise((resolve) => {
    const child = spawn("git", ["config", "--get", "remote.origin.url"], {
      cwd: repoPath,
      stdio: ["ignore", "pipe", "ignore"],
    });
    let out = "";
    child.stdout.on("data", (d) => (out += d.toString()));
    child.on("close", (code) => {
      if (code !== 0) return resolve(null);
      const v = out.trim();
      resolve(v.length > 0 ? v : null);
    });
  });
}

function parseRemoteFullName(remoteUrl: string): string | null {
  // Accept:
  // - git@github.com:owner/name.git
  // - ssh://git@host/owner/name.git
  // - https://host/owner/name(.git)
  const sshScp = remoteUrl.match(/^git@([^:]+):(.+)$/);
  if (sshScp) {
    const pathPart = sshScp[2] ?? "";
    const cleaned = pathPart.replace(/\.git$/, "");
    const [owner, name] = cleaned.split("/");
    return owner && name ? `${owner}/${name}` : null;
  }

  try {
    const u = new URL(remoteUrl);
    const parts = u.pathname.split("/").filter(Boolean);
    if (parts.length < 2) return null;
    const owner = parts[0]!.replace(/\.git$/, "");
    const name = parts[1]!.replace(/\.git$/, "");
    return owner && name ? `${owner}/${name}` : null;
  } catch {
    return null;
  }
}

async function listLocalRepos(reposDir: string): Promise<LocalRepo[]> {
  if (!existsSync(reposDir)) return [];

  const entries = readdirSync(reposDir);
  const results: LocalRepo[] = [];

  for (const entry of entries) {
    const fullPath = path.join(reposDir, entry);
    let st;
    try {
      st = statSync(fullPath);
    } catch {
      continue;
    }
    if (!st.isDirectory()) continue;
    if (!existsSync(path.join(fullPath, ".git"))) continue;

    const remoteUrl = await getGitRemoteUrl(fullPath);
    const remoteFullName = remoteUrl ? parseRemoteFullName(remoteUrl) : null;
    results.push({
      path: fullPath,
      dirName: entry,
      remoteUrl,
      remoteFullName,
    });
  }

  return results;
}

function pickMatchingLocalRepo(
  projectName: string,
  repos: LocalRepo[],
): LocalRepo | null {
  const pn = normalizeName(projectName);
  if (!pn) return null;

  const exact = repos.find(
    (r) => normalizeName(r.remoteFullName ?? r.dirName) === pn,
  );
  if (exact) return exact;

  const contains = repos.find((r) => {
    const rn = normalizeName(r.remoteFullName ?? r.dirName);
    return rn.includes(pn) || pn.includes(rn);
  });
  return contains ?? null;
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

function pickMatchingRepo(
  project: { name: string; key: string },
  unifiedRepos: UnifiedRepo[],
) {
  const scored = unifiedRepos
    .map((r) => {
      const repoSlug = r.preferred.repo.fullName.split("/").pop() ?? "";
      const score = scoreRepoMatch({
        projectKey: project.key,
        projectName: project.name,
        repoSlugCandidates: [r.preferred.repo.name, repoSlug],
        repoFullNameCandidates: [r.preferred.repo.fullName],
      });
      return { item: r, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);

  const best = pickBestByScore(scored);
  return {
    best: best.best,
    bestScore: best.bestScore,
    ambiguous: best.ambiguous,
    top: scored
      .slice(0, 5)
      .map((x) => ({ fullName: x.item.fullName, score: x.score })),
  };
}

function pickMatchingLocalRepos(
  project: { name: string; key: string },
  repos: LocalRepo[],
) {
  const scored = repos
    .map((r) => {
      const slug = r.remoteFullName ? r.remoteFullName.split("/").pop() : null;
      const score = scoreRepoMatch({
        projectKey: project.key,
        projectName: project.name,
        repoSlugCandidates: [slug ?? "", r.dirName],
        repoFullNameCandidates: [r.remoteFullName ?? ""],
      });
      return { item: r, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);

  const best = pickBestByScore(scored);
  return {
    best: best.best,
    bestScore: best.bestScore,
    ambiguous: best.ambiguous,
    top: scored.slice(0, 5).map((x) => ({
      path: x.item.path,
      dirName: x.item.dirName,
      remoteFullName: x.item.remoteFullName,
      score: x.score,
    })),
  };
}

export type KanbangerSyncReposResult = {
  workspaceId: string;
  userId: string;
  projects: number;
  cloned: number;
  skipped: number;
  unmatched: number;
  errors: number;
  debug?: {
    dryRun: boolean;
    reposDir: string;
    localRepoCount: number;
    connections: Array<{ provider: string; instanceUrl: string | null }>;
  };
  results: Array<{
    projectId: string;
    projectName: string;
    status: "matched" | "unmatched" | "cloned" | "skipped" | "error";
    repoFullName?: string;
    candidates?: {
      local?: Array<{
        path: string;
        dirName: string;
        remoteFullName: string | null;
        score: number;
      }>;
      remote?: Array<{ fullName: string; score: number }>;
    };
    error?: string;
  }>;
};

type ErrorWithStatusCode = Error & { statusCode?: number };

export async function syncKanbangerReposForBobUser(input: {
  workspaceId?: string | null;
  userId?: string | null;
  dryRun?: boolean;
  includeCandidates?: boolean;
}): Promise<KanbangerSyncReposResult> {
  if (!KANBANGER_API_KEY) {
    const err: ErrorWithStatusCode = new Error(
      "KANBANGER_API_KEY not configured",
    );
    err.statusCode = 412;
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

  const localRepos = await listLocalRepos(reposDir);

  const results: KanbangerSyncReposResult["results"] = [];

  const dryRun = input.dryRun === true;
  const includeCandidates = input.includeCandidates === true;

  for (const p of projects) {
    const localPick = pickMatchingLocalRepos(p.project, localRepos);
    const remotePick = localPick.best
      ? null
      : pickMatchingRepo(p.project, merged);

    const candidatesPayload = includeCandidates
      ? {
          local: localPick.top,
          remote: remotePick?.top,
        }
      : undefined;

    if (localPick.ambiguous) {
      results.push({
        projectId: p.project.id,
        projectName: p.project.name,
        status: "error",
        candidates: candidatesPayload,
        error: `Ambiguous local repo match`,
      });
      continue;
    }

    if (!localPick.best && remotePick?.ambiguous) {
      results.push({
        projectId: p.project.id,
        projectName: p.project.name,
        status: "error",
        candidates: candidatesPayload,
        error: `Ambiguous remote repo match`,
      });
      continue;
    }

    const localMatch = localPick.best;
    const match = localMatch ? null : (remotePick?.best ?? null);

    if (!localMatch && !match) {
      results.push({
        projectId: p.project.id,
        projectName: p.project.name,
        status: "unmatched",
        candidates: candidatesPayload,
      });
      continue;
    }

    const preferred = match?.preferred.repo;
    const repoFullName =
      localMatch?.remoteFullName ?? preferred?.fullName ?? undefined;
    const dirName = preferred
      ? safeRepoDirName(preferred.fullName)
      : safeRepoDirName(localMatch!.dirName);
    const clonePath = localMatch
      ? localMatch.path
      : path.join(reposDir, dirName);

    try {
      if (dryRun) {
        results.push({
          projectId: p.project.id,
          projectName: p.project.name,
          status: localMatch ? "matched" : "cloned",
          repoFullName,
          candidates: candidatesPayload,
        });
        continue;
      }

      const existingForProject = await db.query.repositories.findFirst({
        where: and(
          eq(repositories.userId, targetUser.id),
          eq(repositories.kanbangerProjectId, p.project.id),
        ),
      });

      if (existingForProject && existingForProject.path !== clonePath) {
        results.push({
          projectId: p.project.id,
          projectName: p.project.name,
          status: "error",
          repoFullName,
          candidates: candidatesPayload,
          error: `Project already mapped to a different repo path (${existingForProject.path})`,
        });
        continue;
      }

      const existingByPath = await db.query.repositories.findFirst({
        where: and(
          eq(repositories.userId, targetUser.id),
          eq(repositories.path, clonePath),
        ),
      });

      if (
        existingByPath?.kanbangerProjectId &&
        existingByPath.kanbangerProjectId !== p.project.id
      ) {
        results.push({
          projectId: p.project.id,
          projectName: p.project.name,
          status: "error",
          repoFullName,
          candidates: candidatesPayload,
          error: `Repo path already mapped to a different project (${existingByPath.kanbangerProjectId})`,
        });
        continue;
      }

      if (!existsSync(clonePath)) {
        if (!preferred) {
          throw new Error(
            `Local repo for '${p.project.name}' not found at ${clonePath}`,
          );
        }

        await runGit(["clone", "--", preferred.sshUrl, clonePath]);
      }

      const legacyRepo = await gitService.addRepository(
        clonePath,
        targetUser.id,
      );

      const remoteUrl = localMatch?.remoteUrl ?? preferred?.sshUrl ?? null;
      const remoteProvider = match?.preferred.provider ?? null;
      const remoteOwner = preferred?.owner ?? null;
      const remoteName = preferred?.name ?? null;

      if (existingByPath) {
        await db
          .update(repositories)
          .set({
            kanbangerProjectId: p.project.id,
            remoteUrl,
            remoteProvider,
            remoteOwner,
            remoteName,
          })
          .where(
            and(
              eq(repositories.id, existingByPath.id),
              eq(repositories.userId, targetUser.id),
            ),
          );

        results.push({
          projectId: p.project.id,
          projectName: p.project.name,
          status: "matched",
          repoFullName,
          candidates: candidatesPayload,
        });
        continue;
      }

      await db.insert(repositories).values({
        userId: targetUser.id,
        kanbangerProjectId: p.project.id,
        name: legacyRepo.name,
        path: legacyRepo.path,
        branch: legacyRepo.branch,
        mainBranch: legacyRepo.mainBranch,
        remoteUrl,
        remoteProvider,
        remoteOwner,
        remoteName,
      });

      results.push({
        projectId: p.project.id,
        projectName: p.project.name,
        status: match ? "cloned" : "matched",
        repoFullName,
        candidates: candidatesPayload,
      });
    } catch (error) {
      results.push({
        projectId: p.project.id,
        projectName: p.project.name,
        status: "error",
        repoFullName,
        candidates: candidatesPayload,
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
    debug: {
      dryRun,
      reposDir,
      localRepoCount: localRepos.length,
      connections: connections.map((c) => ({
        provider: c.provider,
        instanceUrl: c.instanceUrl,
      })),
    },
    results,
  };
}
