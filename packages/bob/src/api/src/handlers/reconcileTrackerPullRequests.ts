// Tracker PR reconciler — make sure a finished run on a Kanbanger-imported
// work item ends in a recorded pull request, and report it ready for review.
//
// Why this exists. The ready-for-review report (announceReadyForReview →
// mirrorWorkItemEvent → Kanbanger's delivery API) only ever fired from the
// auto-merge loop, and that loop only iterates `pull_requests` rows. Those rows
// are written in exactly one place: the ws-gateway, when a runner's
// "completed" status carries a `pullRequestUrl`. Both halves of that hand-off
// fail silently in production:
//   - the runner opens a PR only when the repo's `origin` embeds a token (or is
//     github.com). For an SSH remote it pushes the branch and logs "no PR
//     method … (open PR manually)" — every Forgejo checkout under
//     /home/bob/dev on hetzner-bob is SSH;
//   - the gateway drops the PR when the completion arrives after the session
//     was already reaped (terminal-is-final rejects the transition before
//     recordPullRequest runs) — PRs levelforge#298, playtrek#186 and
//     driftport#14 were opened on 2026-09-03 and never recorded.
// No `pull_requests` row has been written since 2026-08-30, so Kanbanger has
// never received a report.
//
// This sweep closes the gap from the side Bob controls (the Worker, which also
// holds the Forgejo token): for each recently completed execute run of a
// tracker item that has no PR linked, find the PR for its branch, or open one
// if the run pushed commits, record it like the gateway would, and announce it.
// Scope is deliberately narrow — tracker items only, a short look-back window —
// so internal work items keep their current behaviour exactly.

import { and, desc, eq, gte, isNotNull, isNull } from "@bob/db";
import type { Db } from "@bob/db/client";
import { pullRequests, repositories, taskRuns, workItems } from "@bob/db/schema";
import { trackerIdentifierOf } from "@bob/work-items/branch-name";

import { createGiteaClient } from "../services/git/providers/gitea";
import type { GitProviderClient, GitPullRequest } from "../services/git/providers/types";
import type { RemotePrView } from "./autoMergeReview";

type PrRow = typeof pullRequests.$inferSelect;

export interface TrackerPrConfig {
  /** Shared Forgejo token (BOB_FORGEJO_TOKEN) — the only credential used. */
  forgejoToken?: string;
  /** Instance the token is valid for. Repos on any other host are skipped. */
  forgejoInstanceUrl?: string;
  /** Runs examined per tick. */
  maxPerRun?: number;
  /** Only runs completed within this window are considered. */
  lookbackHours?: number;
  /** Test seams. */
  clientFor?: (token: string, instanceUrl: string) => GitProviderClient;
  announce?: (pr: PrRow, remote: RemotePrView) => Promise<unknown>;
  now?: () => Date;
}

export type TrackerPrOutcome =
  | "recorded" // found the PR the runner opened and recorded it
  | "opened" // the runner pushed but opened no PR; opened it here
  | "no_branch" // nothing was pushed for this run — nothing to review
  | "stale_branch" // the branch predates this run (no new commits)
  | "no_diff" // the branch has nothing to merge
  | "unsupported" // repo not on the Forgejo instance the token is for
  | "error"; // transient — retried next tick

export interface TrackerPrResult {
  scanned: number;
  recorded: number;
  opened: number;
  announced: number;
  items: { run: string; identifier: string | null; outcome: TrackerPrOutcome; detail?: string }[];
}

/** Outcomes that settle a run for good (an error is retried next tick). */
const SETTLED: ReadonlySet<TrackerPrOutcome> = new Set([
  "recorded",
  "opened",
  "no_branch",
  "stale_branch",
  "no_diff",
  "unsupported",
]);

/** Work-item metadata key holding settled run ids → outcome (bounded). */
const CHECKS_KEY = "trackerPrChecks";
const MAX_CHECKS = 20;

/** The agent's commits are made during the run; allow for clock skew. */
const COMMIT_SKEW_MS = 10 * 60 * 1000;

interface CandidateRun {
  runId: string;
  userId: string;
  sessionId: string | null;
  branch: string | null;
  createdAt: string;
  identifierSnapshot: string | null;
  workItemId: string;
  title: string;
  description: string | null;
  externalProvider: string | null;
  externalId: string | null;
  externalUrl: string | null;
  sourceMetadata: unknown;
  repositoryId: string;
  remoteUrl: string | null;
  remoteOwner: string | null;
  remoteName: string | null;
  remoteInstanceUrl: string | null;
  mainBranch: string;
}

export async function reconcileTrackerPullRequests(
  db: Db,
  cfg: TrackerPrConfig,
): Promise<TrackerPrResult> {
  const result: TrackerPrResult = { scanned: 0, recorded: 0, opened: 0, announced: 0, items: [] };
  if (!cfg.forgejoToken) return result;
  const instanceUrl = (cfg.forgejoInstanceUrl ?? "https://git.forgegraf.com").replace(/\/+$/, "");
  const now = cfg.now?.() ?? new Date();
  const since = new Date(now.getTime() - (cfg.lookbackHours ?? 72) * 3600_000).toISOString();
  const limit = cfg.maxPerRun ?? 10;

  const rows = (await db
    .select({
      runId: taskRuns.id,
      userId: taskRuns.userId,
      sessionId: taskRuns.sessionId,
      branch: taskRuns.branch,
      createdAt: taskRuns.createdAt,
      identifierSnapshot: taskRuns.workItemIdentifierSnapshot,
      workItemId: workItems.id,
      title: workItems.title,
      description: workItems.description,
      externalProvider: workItems.externalProvider,
      externalId: workItems.externalId,
      externalUrl: workItems.externalUrl,
      sourceMetadata: workItems.sourceMetadata,
      repositoryId: repositories.id,
      remoteUrl: repositories.remoteUrl,
      remoteOwner: repositories.remoteOwner,
      remoteName: repositories.remoteName,
      remoteInstanceUrl: repositories.remoteInstanceUrl,
      mainBranch: repositories.mainBranch,
    })
    .from(taskRuns)
    .innerJoin(workItems, eq(workItems.id, taskRuns.workItemId))
    .innerJoin(repositories, eq(repositories.id, taskRuns.repositoryId))
    .where(
      and(
        eq(taskRuns.runPhase, "execute"),
        eq(taskRuns.status, "completed"),
        isNull(taskRuns.pullRequestId),
        isNotNull(taskRuns.branch),
        eq(workItems.externalProvider, "linear"),
        gte(taskRuns.completedAt, since),
      ),
    )
    .orderBy(desc(taskRuns.completedAt))
    .limit(limit * 3)) as CandidateRun[];

  const pending = rows.filter((r) => !settledRuns(r.sourceMetadata).includes(r.runId)).slice(0, limit);
  result.scanned = pending.length;
  const clientFor = cfg.clientFor ?? createGiteaClient;
  const client = clientFor(cfg.forgejoToken, instanceUrl);

  for (const run of pending) {
    const identifier = trackerIdentifierOf(run);
    const note = (outcome: TrackerPrOutcome, detail?: string) => {
      result.items.push({ run: run.runId.slice(0, 8), identifier, outcome, ...(detail ? { detail } : {}) });
      return outcome;
    };
    let outcome: TrackerPrOutcome;
    try {
      outcome = await reconcileRun(db, client, instanceUrl, run, identifier, now, note, async (pr, remote) => {
        await (cfg.announce ?? defaultAnnounce)(pr, remote);
        result.announced++;
      });
    } catch (err) {
      outcome = note("error", (err instanceof Error ? err.message : String(err)).slice(0, 200));
    }
    if (outcome === "recorded") result.recorded++;
    if (outcome === "opened") result.opened++;
    if (SETTLED.has(outcome)) await markSettled(db, run.workItemId, run.runId, outcome).catch(() => undefined);
  }
  return result;
}

async function reconcileRun(
  db: Db,
  client: GitProviderClient,
  instanceUrl: string,
  run: CandidateRun,
  identifier: string | null,
  now: Date,
  note: (outcome: TrackerPrOutcome, detail?: string) => TrackerPrOutcome,
  announce: (pr: PrRow, remote: RemotePrView) => Promise<void>,
): Promise<TrackerPrOutcome> {
  const branch = run.branch ?? "";
  const remote = forgejoRemote(run, instanceUrl);
  if (!remote) return note("unsupported", "repository is not on the Forgejo instance Bob holds a token for");
  const { owner, name } = remote;

  // 1. The runner opened a PR but the gateway never recorded it.
  let pr = await client.findPullRequestByHead?.(owner, name, branch);
  let outcome: TrackerPrOutcome = "recorded";

  if (!pr) {
    // 2. No PR: open one only if THIS run pushed commits to the branch. A
    // missing branch means the agent produced nothing (the runner pushes only
    // when there are commits); a branch whose head predates the run is an
    // earlier attempt's work that this run did not touch.
    let head;
    try {
      [head] = await client.listCommits(owner, name, branch, 1);
    } catch (err) {
      if (/\((404|409|422)\)/.test(String(err))) return note("no_branch");
      throw err;
    }
    if (!head) return note("no_branch");
    if (head.committedAt.getTime() < parseDbTimestamp(run.createdAt) - COMMIT_SKEW_MS) {
      return note("stale_branch", `head ${head.sha.slice(0, 8)} predates the run`);
    }
    try {
      pr = await client.createPullRequest({
        owner,
        repo: name,
        head: branch,
        base: run.mainBranch,
        title: prTitle(identifier, run.title),
        body: prBody(identifier, run),
      });
      outcome = "opened";
    } catch (err) {
      const msg = String(err);
      // 409: a PR for this head appeared meanwhile (the runner, or a parallel
      // tick) — find it. 422: nothing to merge between base and head.
      if (msg.includes("(409)")) pr = await client.findPullRequestByHead?.(owner, name, branch);
      else if (msg.includes("(422)")) return note("no_diff");
      if (!pr) throw err;
    }
  }

  const row = await recordPullRequest(db, run, pr, instanceUrl, owner, name);
  await db.update(taskRuns).set({ pullRequestId: row.id }).where(eq(taskRuns.id, run.runId));
  note(outcome, pr.url);

  if (row.status === "open" && !pr.draft) {
    await announce(row, { title: pr.title, body: pr.body, headSha: pr.headSha ?? null });
  }
  return outcome;
}

/** Same row the gateway's recordPullRequest writes, idempotent on the URL. */
async function recordPullRequest(
  db: Db,
  run: CandidateRun,
  pr: GitPullRequest,
  instanceUrl: string,
  owner: string,
  name: string,
): Promise<PrRow> {
  const existing = await db.query.pullRequests.findFirst({ where: eq(pullRequests.url, pr.url) });
  if (existing) return existing;
  const [row] = await db
    .insert(pullRequests)
    .values({
      userId: run.userId,
      repositoryId: run.repositoryId,
      provider: "gitea",
      instanceUrl,
      remoteOwner: owner,
      remoteName: name,
      number: pr.number,
      headBranch: pr.headBranch,
      baseBranch: pr.baseBranch,
      title: pr.title,
      body: pr.body,
      status: pr.state,
      url: pr.url,
      // workItemIdForPr resolves the work item through the session — this is
      // what lets the ready report and settlement find the item.
      sessionId: run.sessionId,
      planningTaskId: run.identifierSnapshot,
      mergedAt: pr.mergedAt?.toISOString() ?? null,
      closedAt: pr.closedAt?.toISOString() ?? null,
    })
    .returning();
  if (!row) throw new Error(`could not record ${pr.url}`);
  return row;
}

/** Owner/name of a repo on `instanceUrl`, or null if it lives elsewhere. */
export function forgejoRemote(
  repo: Pick<CandidateRun, "remoteUrl" | "remoteOwner" | "remoteName" | "remoteInstanceUrl">,
  instanceUrl: string,
): { owner: string; name: string } | null {
  const wantHost = new URL(instanceUrl).hostname;
  const parsed = parseRemote(repo.remoteUrl ?? "");
  const host = repo.remoteInstanceUrl ? safeHost(repo.remoteInstanceUrl) : parsed?.host;
  if (host !== wantHost) return null;
  const owner = repo.remoteOwner ?? parsed?.owner;
  const name = repo.remoteName ?? parsed?.name;
  return owner && name ? { owner, name } : null;
}

function safeHost(url: string): string | undefined {
  try {
    return new URL(url).hostname;
  } catch {
    return undefined;
  }
}

/** host/owner/name from an SSH (`git@host:o/r.git`) or HTTPS remote. Never returns credentials. */
function parseRemote(url: string): { host: string; owner: string; name: string } | null {
  const ssh = /^(?:ssh:\/\/)?[^@/]+@([^:/]+)[:/](?:\d+\/)?([^/]+)\/(.+?)(?:\.git)?\/?$/.exec(url);
  if (ssh?.[1] && ssh[2] && ssh[3]) return { host: ssh[1], owner: ssh[2], name: ssh[3] };
  const https = /^https?:\/\/(?:[^@/]+@)?([^/:]+)(?::\d+)?\/([^/]+)\/(.+?)(?:\.git)?\/?$/.exec(url);
  if (https?.[1] && https[2] && https[3]) return { host: https[1], owner: https[2], name: https[3] };
  return null;
}

/** `GMA-612: <title>` for tracker items, so Kanbanger links the PR by title. */
export function prTitle(identifier: string | null, title: string): string {
  if (!identifier) return `[Bob] ${title}`;
  const bare = title.startsWith(`${identifier}: `) ? title.slice(identifier.length + 2) : title;
  return `${identifier}: ${bare}`;
}

function prBody(identifier: string | null, run: CandidateRun): string {
  const description = run.description?.trim();
  return [
    description ? (description.length > 1500 ? `${description.slice(0, 1500)}…` : description) : null,
    "---",
    `Opened by Bob after run ${run.runId.slice(0, 8)} finished and pushed \`${run.branch}\` without a pull request.`,
    run.externalUrl ? `Tracker: ${run.externalUrl}` : null,
    identifier ? `\nRefs: ${identifier}` : null,
  ]
    .filter((line): line is string => line !== null)
    .join("\n\n");
}

/**
 * `task_runs.created_at` is `timestamp without time zone` holding UTC, and
 * comes back as "2026-10-06 00:19:08.322215". Normalise to ISO-8601 UTC.
 */
export function parseDbTimestamp(value: string): number {
  const iso = value.trim().replace(" ", "T").replace(/(\.\d{3})\d+/, "$1");
  return Date.parse(/(Z|[+-]\d{2}:?\d{2})$/.test(iso) ? iso : `${iso}Z`);
}

function settledRuns(meta: unknown): string[] {
  const checks = (meta as Record<string, unknown> | null)?.[CHECKS_KEY];
  return checks && typeof checks === "object" ? Object.keys(checks) : [];
}

async function markSettled(db: Db, workItemId: string, runId: string, outcome: TrackerPrOutcome) {
  const row = await db.query.workItems.findFirst({
    where: eq(workItems.id, workItemId),
    columns: { sourceMetadata: true },
  });
  const meta = { ...(row?.sourceMetadata) };
  const prior = (meta[CHECKS_KEY] ?? {}) as Record<string, string>;
  const entries = [...Object.entries(prior).filter(([id]) => id !== runId), [runId, outcome]].slice(-MAX_CHECKS);
  meta[CHECKS_KEY] = Object.fromEntries(entries);
  await db.update(workItems).set({ sourceMetadata: meta }).where(eq(workItems.id, workItemId));
}

async function defaultAnnounce(pr: PrRow, remote: RemotePrView): Promise<void> {
  const { announceReadyForReview } = await import("./autoMergeReview");
  await announceReadyForReview(pr, remote);
}
