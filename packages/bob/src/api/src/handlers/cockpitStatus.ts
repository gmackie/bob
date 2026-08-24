// Cockpit status — one payload that answers "is the loop alive, what's next,
// who's working on what, where is each change stuck" for /cockpit.
//
// Composes the collectors the loop already has (pacing, agent health, starvation
// inputs, deploy evidence) with the queue/session/PR tables, plus a cached
// per-PR read of Forgejo (CI status + bob-reviewer verdict at head). Read-only.
// Polled every ~10 s by the wall and on workspace broadcasts; Forgejo lookups
// are cached 30 s by head SHA so the fan-out stays flat.

import { and, desc, eq, gt, inArray, sql } from "@bob/db";
import { db } from "@bob/db/client";
import {
  chatConversations,
  cockpitAudit,
  pullRequests,
  repositories,
  taskRuns,
  workItemArtifacts,
  workItems,
  workspaceIntegrations,
} from "@bob/db/schema";

import { assessAgentHealth } from "../services/automation/agentHealthRouter.js";
import { derivePipeline } from "../services/cockpit/pipeline.js";
import type { PipelineFacts } from "../services/cockpit/pipeline.js";
import { toDate } from "../services/cockpit/toDate.js";
import type {
  AgentHealthChip,
  CockpitStatus,
  LiveSession,
  PriorityLane,
  PrPipeline,
  QueueCard,
  TimelineEvent,
} from "../services/cockpit/types.js";
import { createProviderClient, getConnection } from "../services/git/providerConnectionService.js";
import type { GitProvider } from "../services/git/providers/types.js";
import { paceDailyBudget } from "../services/health/pacing.js";

const ACTIVE = ["pending", "provisioning", "starting", "running", "blocked", "stopping", "host_unknown"];
const LANE_BY_ORDER: Record<number, PriorityLane> = { 10: "urgent", 20: "high", 30: "medium", 40: "unset", 50: "low" };
const REPAIR_CAP_DEFAULT = 3;


export interface CockpitStatusConfig {
  forgejoToken?: string;
  forgejoInstanceUrl?: string;
  rotation?: string[];
  repairCap?: number;
  /** Include OODA-originated items/sessions (hidden by default on the wall). */
  includeOoda?: boolean;
}

// --- Forgejo cache (per isolate) -------------------------------------------
interface PrRemote {
  headSha: string | null;
  mergeable: boolean | null;
  ciState: string;
  ciTotal: number;
  jobs: { name: string; status: string }[];
  verdict: PipelineFacts["verdict"];
  verdictBy: string | null;
  fetchedAt: number;
}
const remoteCache = new Map<string, PrRemote>();
const REMOTE_TTL_MS = 30_000;

async function fetchPrRemote(
  pr: { id: string; userId: string; provider: string; instanceUrl: string | null; remoteOwner: string; remoteName: string; number: number },
  cfg: CockpitStatusConfig,
  reviewerLogin: string,
): Promise<PrRemote | null> {
  const cached = remoteCache.get(pr.id);
  if (cached && Date.now() - cached.fetchedAt < REMOTE_TTL_MS) return cached;
  try {
    const connection = await getConnection(pr.userId, pr.provider as GitProvider, pr.instanceUrl);
    let token: string | undefined = connection?.accessToken;
    if (!token && pr.provider === "gitea" && cfg.forgejoToken && pr.instanceUrl === (cfg.forgejoInstanceUrl ?? "https://git.forgegraf.com")) {
      token = cfg.forgejoToken;
    }
    if (!token) return null;
    const client = createProviderClient(pr.provider as GitProvider, token, pr.instanceUrl);
    if (!client.getCommitStatus || !client.listPullRequestReviews) return null;
    const remote = await client.getPullRequest(pr.remoteOwner, pr.remoteName, pr.number);
    const headSha = remote.headSha ?? null;
    let ciState = "none";
    let ciTotal = 0;
    let jobs: { name: string; status: string }[] = [];
    let verdict: PipelineFacts["verdict"] = null;
    let verdictBy: string | null = null;
    if (headSha) {
      const [ci, reviews] = await Promise.all([
        client.getCommitStatus(pr.remoteOwner, pr.remoteName, headSha).catch(() => null),
        client.listPullRequestReviews(pr.remoteOwner, pr.remoteName, pr.number).catch(() => []),
      ]);
      if (ci) {
        ciState = ci.state;
        ciTotal = ci.total;
        jobs = (ci.statuses ?? []).map((st) => ({ name: st.context, status: st.state }));
      }
      const mine = reviews.filter((r) => r.userLogin === reviewerLogin && r.commitId === headSha);
      const last = mine[mine.length - 1];
      if (last) {
        const st = last.state.toUpperCase();
        verdict = st === "APPROVED" ? "APPROVED" : st === "REQUEST_CHANGES" || st === "CHANGES_REQUESTED" ? "REQUEST_CHANGES" : "COMMENT";
        verdictBy = reviewerLogin;
      }
    }
    const rec: PrRemote = {
      headSha,
      mergeable: remote.mergeable ?? null,
      ciState,
      ciTotal,
      jobs,
      verdict,
      verdictBy,
      fetchedAt: Date.now(),
    };
    remoteCache.set(pr.id, rec);
    return rec;
  } catch {
    return cached ?? null;
  }
}

// --- main ------------------------------------------------------------------
export async function cockpitStatus(cfg: CockpitStatusConfig = {}): Promise<CockpitStatus> {
  const now = new Date();
  const since24h = new Date(now.getTime() - 24 * 3600_000).toISOString();
  const since2h = new Date(now.getTime() - 2 * 3600_000).toISOString();
  const rotation = cfg.rotation ?? ["claude", "codex", "grok", "cursor"];
  const repairCap = cfg.repairCap ?? REPAIR_CAP_DEFAULT;

  const [cfgRow, integ, counts, queueRows, liveRows, healthRows, todayRows, lastRun] = await Promise.all([
    db.query.autoDrainConfig.findFirst(),
    db.query.workspaceIntegrations.findFirst({
      where: and(eq(workspaceIntegrations.provider, "linear"), eq(workspaceIntegrations.enabled, true)),
      columns: { lastSyncedAt: true, lastSyncResult: true },
    }),
    db.select({ status: workItems.status, n: sql<number>`count(*)::int` }).from(workItems).groupBy(workItems.status),
    db
      .select({
        id: workItems.id,
        title: workItems.title,
        status: workItems.status,
        queueSortOrder: workItems.queueSortOrder,
        agentTypeOverride: workItems.agentTypeOverride,
        externalProvider: workItems.externalProvider,
        externalId: workItems.externalId,
        createdAt: workItems.createdAt,
        projectId: workItems.projectId,
      })
      .from(workItems)
      .where(and(eq(workItems.kind, "task"), inArray(workItems.status, ["ready", "todo"])))
      .orderBy(sql`case when ${workItems.status} = 'ready' then 0 else 1 end`, workItems.queueSortOrder, workItems.createdAt)
      .limit(120),
    db
      .select({
        id: chatConversations.id,
        agent: chatConversations.agentType,
        status: chatConversations.status,
        title: chatConversations.title,
        createdAt: chatConversations.createdAt,
        workItemId: chatConversations.workItemId,
        identifier: chatConversations.workItemIdentifierSnapshot,
        gitBranch: chatConversations.gitBranch,
        repositoryId: chatConversations.repositoryId,
        sessionType: chatConversations.sessionType,
      })
      .from(chatConversations)
      .where(inArray(chatConversations.status, ACTIVE))
      .orderBy(desc(chatConversations.createdAt))
      .limit(40),
    db
      .select({
        agent: chatConversations.agentType,
        completed: sql<number>`count(*) filter (where ${chatConversations.status} = 'completed')::int`,
        errored: sql<number>`count(*) filter (where ${chatConversations.status} in ('error','failed'))::int`,
      })
      .from(chatConversations)
      .where(gt(chatConversations.createdAt, since2h))
      .groupBy(chatConversations.agentType),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(taskRuns)
      .where(sql`${taskRuns.createdAt} >= date_trunc('day', now()) and coalesce(${taskRuns.runPhase},'execute')='execute'`),
    db
      .select({ at: sql<string | null>`max(${taskRuns.createdAt})::text` })
      .from(taskRuns),
  ]);

  // --- loop + pacing
  const concurrency = cfgRow?.concurrency ?? 4;
  const cap = cfgRow?.dailyCap ?? 40;
  const used = todayRows[0]?.n ?? 0;
  const pacing = paceDailyBudget({
    dailyCap: cap,
    executeToday: used,
    minuteOfDay: now.getUTCHours() * 60 + now.getUTCMinutes(),
    burst: concurrency,
  });
  const syncedAt = toDate(integ?.lastSyncedAt);
  const lastTickAt = toDate(lastRun[0]?.at);

  // --- agents
  const manuallyDisabled = new Set(((cfgRow?.disabledAgents ?? [])));
  const verdicts = assessAgentHealth(rotation, healthRows.map((r) => ({ agent: r.agent, completed: r.completed, errored: r.errored })));
  const agents: AgentHealthChip[] = verdicts.map((v) => {
    const s = healthRows.find((r) => r.agent === v.agent);
    return {
      agent: v.agent,
      completed: s?.completed ?? 0,
      errored: s?.errored ?? 0,
      healthy: v.healthy && !manuallyDisabled.has(v.agent),
      reason: manuallyDisabled.has(v.agent) ? "pulled from rotation (cockpit)" : v.reason,
      inRotation: rotation.includes(v.agent) && !manuallyDisabled.has(v.agent),
    };
  });

  // --- queue
  const projectRepo = new Map<string, string>();
  const projectIds = [...new Set(queueRows.map((q) => q.projectId).filter((p): p is string => !!p))];
  if (projectIds.length) {
    const repos = await db
      .select({ projectId: repositories.planningProjectId, name: repositories.remoteName })
      .from(repositories)
      .limit(200);
    for (const r of repos) if (r.projectId && r.name) projectRepo.set(r.projectId, r.name);
  }
  const lanes: Record<PriorityLane, QueueCard[]> = { urgent: [], high: [], medium: [], unset: [], low: [] };
  for (const q of queueRows) {
    if (!cfg.includeOoda && q.externalProvider === "ooda") continue;
    const lane = LANE_BY_ORDER[q.queueSortOrder] ?? "unset";
    lanes[lane].push({
      id: q.id,
      identifier: q.externalId && /^[A-Z]+-\d+$/.test(q.externalId) ? q.externalId : null,
      title: q.title,
      repo: q.projectId ? (projectRepo.get(q.projectId) ?? null) : null,
      lane,
      ready: q.status === "ready",
      agentOverride: q.agentTypeOverride,
      provider: q.externalProvider,
      ageMinutes: Math.round((now.getTime() - (toDate(q.createdAt) ?? now).getTime()) / 60000),
    });
  }
  const cnt = Object.fromEntries(counts.map((c) => [c.status, c.n])) as Record<string, number>;

  // --- sessions
  const repoIds = [...new Set(liveRows.map((l) => l.repositoryId).filter((r): r is string => !!r))];
  const repoName = new Map<string, string>();
  if (repoIds.length) {
    const rs = await db.select({ id: repositories.id, name: repositories.remoteName }).from(repositories).where(inArray(repositories.id, repoIds));
    for (const r of rs) repoName.set(r.id, r.name ?? "");
  }
  const sessionPr = new Map<string, { number: number; repo: string; url: string }>();
  if (liveRows.length) {
    const prs = await db
      .select({ sessionId: pullRequests.sessionId, number: pullRequests.number, repo: pullRequests.remoteName, url: pullRequests.url })
      .from(pullRequests)
      .where(inArray(pullRequests.sessionId, liveRows.map((l) => l.id)));
    for (const p of prs) if (p.sessionId) sessionPr.set(p.sessionId, { number: p.number, repo: p.repo, url: p.url });
  }
  const itemProvider = new Map<string, string | null>();
  const liveItemIds = [...new Set(liveRows.map((l) => l.workItemId).filter((x): x is string => !!x))];
  if (liveItemIds.length) {
    const its = await db.select({ id: workItems.id, p: workItems.externalProvider }).from(workItems).where(inArray(workItems.id, liveItemIds));
    for (const i of its) itemProvider.set(i.id, i.p);
  }
  const sessions: LiveSession[] = liveRows
    .map((l) => {
      const phase: LiveSession["phase"] = l.title?.startsWith("Review:") ? "review" : l.title?.startsWith("Repair:") ? "repair" : l.workItemId ? "execute" : "other";
      const provider = l.workItemId ? (itemProvider.get(l.workItemId) ?? null) : null;
      return {
        id: l.id,
        agent: l.agent,
        status: l.status,
        phase,
        title: l.title ?? "",
        identifier: l.identifier,
        workItemId: l.workItemId,
        repo: l.repositoryId ? (repoName.get(l.repositoryId) ?? null) : null,
        branch: l.gitBranch,
        startedAt: (toDate(l.createdAt) ?? now).toISOString(),
        elapsedSeconds: Math.round((now.getTime() - (toDate(l.createdAt) ?? now).getTime()) / 1000),
        pr: sessionPr.get(l.id) ?? null,
        provider,
      };
    })
    .filter((s) => (cfg.includeOoda ?? false) || s.provider !== "ooda");

  // --- PRs (open + merged in 24h)
  const prRows = await db
    .select()
    .from(pullRequests)
    .where(sql`${pullRequests.status} = 'open' or ${pullRequests.mergedAt} >= ${since24h}`)
    .orderBy(desc(pullRequests.createdAt))
    .limit(60);
  const prIds = prRows.map((p) => p.id);
  const runsByPr = new Map<string, { phase: string; status: string; sessionStatus: string | null }[]>();
  if (prIds.length) {
    const runs = await db
      .select({ prId: taskRuns.pullRequestId, phase: taskRuns.runPhase, status: taskRuns.status, sessionStatus: chatConversations.status })
      .from(taskRuns)
      .leftJoin(chatConversations, eq(chatConversations.id, taskRuns.sessionId))
      .where(inArray(taskRuns.pullRequestId, prIds));
    for (const r of runs) {
      if (!r.prId) continue;
      const arr = runsByPr.get(r.prId) ?? [];
      arr.push({ phase: r.phase, status: r.status, sessionStatus: r.sessionStatus });
      runsByPr.set(r.prId, arr);
    }
  }
  const deployByItem = new Map<string, string>();
  const prItem = new Map<string, string>();
  const prSessionIds = prRows.map((p) => p.sessionId).filter((s): s is string => !!s);
  if (prSessionIds.length) {
    const ss = await db.select({ id: chatConversations.id, wi: chatConversations.workItemId, ident: chatConversations.workItemIdentifierSnapshot }).from(chatConversations).where(inArray(chatConversations.id, prSessionIds));
    const identBySession = new Map<string, string | null>();
    for (const s of ss) { if (s.wi) prItem.set(s.id, s.wi); identBySession.set(s.id, s.ident); }
    const itemIds = [...new Set([...prItem.values()])];
    if (itemIds.length) {
      const arts = await db
        .select({ wi: workItemArtifacts.workItemId, title: workItemArtifacts.title })
        .from(workItemArtifacts)
        .where(and(inArray(workItemArtifacts.workItemId, itemIds), eq(workItemArtifacts.producerId, "deploy-tracker")));
      for (const a of arts) deployByItem.set(a.wi, a.title === "Deployed" ? "success" : "failure");
    }
    for (const p of prRows) (p as unknown as { _ident?: string | null })._ident = p.sessionId ? identBySession.get(p.sessionId) ?? null : null;
  }

  const reviewerLogin = "bob-reviewer";
  const active: PrPipeline[] = [];
  const parked: PrPipeline[] = [];
  await Promise.all(
    prRows.map(async (p) => {
      const remote = p.status === "open" ? await fetchPrRemote(p, cfg, reviewerLogin) : null;
      const runs = runsByPr.get(p.id) ?? [];
      const live = (ph: string) => runs.some((r) => r.phase === ph && ["starting", "running", "blocked"].includes(r.status) && r.sessionStatus != null && ACTIVE.includes(r.sessionStatus));
      const item = p.sessionId ? prItem.get(p.sessionId) : undefined;
      const facts: PipelineFacts = {
        merged: p.status === "merged",
        mergedAt: p.mergedAt,
        closed: p.status === "closed",
        mergeable: remote?.mergeable ?? null,
        ciState: remote?.ciState ?? "none",
        ciTotal: remote?.ciTotal ?? 0,
        verdict: remote?.verdict ?? null,
        reviewInFlight: live("review"),
        repairAttempts: runs.filter((r) => r.phase === "repair").length,
        repairCap,
        repairInFlight: live("repair"),
        deploy: item ? ((deployByItem.get(item) as PipelineFacts["deploy"]) ?? "none") : null,
      };
      const { stages, parkedReason } = derivePipeline(facts);
      const row: PrPipeline = {
        id: p.id,
        repo: p.remoteName,
        number: p.number,
        url: p.url,
        title: p.title.replace(/^\[Bob\]\s*/, ""),
        identifier: (p as unknown as { _ident?: string | null })._ident ?? null,
        headSha: remote?.headSha ?? null,
        openedAt: (toDate(p.createdAt) ?? now).toISOString(),
        stages,
        ci: remote ? { state: remote.ciState, jobs: remote.jobs } : null,
        review: remote ? { verdict: remote.verdict, by: remote.verdictBy } : null,
        repair: { attempts: facts.repairAttempts, cap: repairCap, inFlight: facts.repairInFlight },
        parkedReason,
      };
      (parkedReason && p.status === "open" ? parked : active).push(row);
    }),
  );
  active.sort((a, b) => b.openedAt.localeCompare(a.openedAt));

  // --- timeline + sparklines (24h, hourly buckets)
  const [dispatchEv, prEv, mergeEv, errEv, deployEv] = await Promise.all([
    db.select({ at: taskRuns.createdAt, ident: taskRuns.workItemIdentifierSnapshot, sessionId: taskRuns.sessionId }).from(taskRuns).where(sql`${taskRuns.createdAt} >= ${since24h} and coalesce(${taskRuns.runPhase},'execute')='execute'`),
    db.select({ at: pullRequests.createdAt, repo: pullRequests.remoteName, number: pullRequests.number, url: pullRequests.url }).from(pullRequests).where(gt(pullRequests.createdAt, since24h)),
    db.select({ at: pullRequests.mergedAt, repo: pullRequests.remoteName, number: pullRequests.number, url: pullRequests.url }).from(pullRequests).where(gt(pullRequests.mergedAt, since24h)),
    db.select({ at: chatConversations.createdAt, agent: chatConversations.agentType, title: chatConversations.title }).from(chatConversations).where(and(gt(chatConversations.createdAt, since24h), inArray(chatConversations.status, ["error", "failed"]))),
    db.select({ at: workItemArtifacts.createdAt, title: workItemArtifacts.title, url: workItemArtifacts.url }).from(workItemArtifacts).where(and(gt(workItemArtifacts.createdAt, since24h), eq(workItemArtifacts.producerId, "deploy-tracker"))),
  ]);
  const agentBySession = new Map<string, string>();
  if (dispatchEv.length) {
    const ids = dispatchEv.map((d) => d.sessionId).filter((s): s is string => !!s);
    if (ids.length) {
      const ss = await db.select({ id: chatConversations.id, agent: chatConversations.agentType }).from(chatConversations).where(inArray(chatConversations.id, ids));
      for (const s of ss) agentBySession.set(s.id, s.agent);
    }
  }
  const auditEv = await db
    .select({ at: cockpitAudit.createdAt, action: cockpitAudit.action, target: cockpitAudit.target })
    .from(cockpitAudit)
    .where(gt(cockpitAudit.createdAt, since24h))
    .catch(() => [] as { at: string; action: string; target: string | null }[]);

  const iso = (v: string | Date | null) => {
    const d = toDate(v);
    return (d ?? now).toISOString();
  };
  const timeline: TimelineEvent[] = [
    ...dispatchEv.map((d) => ({ at: iso(d.at), kind: "dispatch" as const, agent: d.sessionId ? (agentBySession.get(d.sessionId) ?? null) : null, label: d.ident ?? "dispatch" })),
    ...prEv.map((p) => ({ at: iso(p.at), kind: "pr" as const, agent: null, label: `${p.repo}#${p.number}`, url: p.url })),
    ...mergeEv.map((p) => ({ at: iso(p.at), kind: "merge" as const, agent: null, label: `${p.repo}#${p.number}`, url: p.url })),
    ...errEv.map((e) => ({ at: iso(e.at), kind: "failure" as const, agent: e.agent, label: (e.title ?? "").slice(0, 40) })),
    ...deployEv.map((d) => ({ at: iso(d.at), kind: d.title === "Deployed" ? ("deploy" as const) : ("deploy_failed" as const), agent: null, label: d.title ?? "deploy", url: d.url ?? undefined })),
    ...auditEv.map((a) => ({ at: iso(a.at), kind: "human" as const, agent: null, label: `${a.action}${a.target ? ` ${a.target}` : ""}` })),
  ].sort((a, b) => a.at.localeCompare(b.at));
  const bucket = (ts: string) => Math.min(23, Math.max(0, 23 - Math.floor((now.getTime() - new Date(ts).getTime()) / 3600_000)));
  const spark = (kind: TimelineEvent["kind"][]) => {
    const arr = new Array<number>(24).fill(0);
    for (const e of timeline) if (kind.includes(e.kind)) arr[bucket(e.at)] = (arr[bucket(e.at)] ?? 0) + 1;
    return arr;
  };

  // --- alerts (derived, no Sentry round-trip)
  const alerts: CockpitStatus["alerts"] = [];
  const syncAge = syncedAt ? (now.getTime() - syncedAt.getTime()) / 1000 : null;
  if (syncAge != null && syncAge > 3600) alerts.push({ id: "linear-sync-stale", message: `Tracker sync stale (${Math.round(syncAge / 60)} min)`, since: syncedAt?.toISOString() ?? null });
  if (integ?.lastSyncResult?.startsWith("error")) alerts.push({ id: "linear-sync-error", message: integ.lastSyncResult.slice(0, 160), since: null });
  for (const a of agents) if (!a.healthy && a.inRotation) alerts.push({ id: `agent-${a.agent}`, message: `${a.agent} pulled by health gate: ${a.reason}`, since: null });
  if (cfgRow && !cfgRow.enabled) alerts.push({ id: "dispatch-paused", message: "Dispatch is paused (auto_drain_config.enabled = false)", since: null });

  return {
    generatedAt: now.toISOString(),
    loop: {
      lastTickAt: lastTickAt?.toISOString() ?? null,
      tickAgeSeconds: lastTickAt ? Math.round((now.getTime() - lastTickAt.getTime()) / 1000) : null,
      syncedAt: syncedAt?.toISOString() ?? null,
      syncAgeSeconds: syncAge == null ? null : Math.round(syncAge),
      syncResult: integ?.lastSyncResult ?? null,
      dispatchEnabled: cfgRow?.enabled ?? true,
    },
    pacing: { cap, used, earned: pacing.earned, allowance: pacing.allowance, burst: concurrency, concurrency, activeSlots: liveRows.length },
    agents,
    queue: { lanes, backlog: cnt.backlog ?? 0, total: Object.values(lanes).reduce((n, l) => n + l.length, 0) },
    sessions,
    prs: { active, parked },
    counts: { todo: (cnt.todo ?? 0) + (cnt.ready ?? 0), inProgress: cnt.in_progress ?? 0, inReview: cnt.in_review ?? 0, blocked: cnt.blocked ?? 0, done: cnt.done ?? 0, backlog: cnt.backlog ?? 0 },
    timeline,
    sparklines: { dispatches: spark(["dispatch"]), merges: spark(["merge"]), errors: spark(["failure", "deploy_failed"]) },
    alerts,
  };
}
