// Deploy-stage tracker for the autonomous loop.
//
// After auto-merge squashes a PR, the change goes live through whatever the
// repo already uses: a `deploy.yml`-style Forgejo Actions workflow on push to
// the default branch, and/or ForgeGraph's own deployment pipeline. Neither
// reported back to the work item or the tracker card, so "merged" was the last
// thing anyone saw — a failed deploy after merge was invisible.
//
// This runs on the worker cron after auto-merge. For each PR merged in the
// last DEPLOY_WINDOW_MS (7 days) that Bob produced, it reads deploy evidence from both
// sources for the MERGE COMMIT, and:
//   - success → 🚀 comment on the card + a `build`/`deployment` artifact on the
//     work item; tracking marked final.
//   - failure → 💥 comment on the card (item stays done — the code IS on the
//     default branch; a human decides whether to revert/fix) + artifact; final.
//   - pending → try again next tick.
//   - none after DEPLOY_GRACE_MS → the repo has no deploy mechanism Bob can
//     see; marked final quietly ("done = merged" for that repo).
// Everything is best-effort and idempotent via work_items.source_metadata.

import { and, desc, eq, gt, isNotNull } from "@bob/db";
import { db } from "@bob/db/client";
import {
  chatConversations,
  pullRequests,
  workItemArtifacts,
  workItems,
} from "@bob/db/schema";

import {
  summarizeDeployEvidence
  
  
  
} from "../services/deploy/deployEvidence.js";
import type {ActionRunEvidence, DeploySummary, FgDeploymentEvidence} from "../services/deploy/deployEvidence.js";
import { mirrorWorkItemEvent } from "../services/tracker/trackerMirror.js";

const DEPLOY_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const DEPLOY_GRACE_MS = 30 * 60 * 1000;

export interface TrackDeploymentsConfig {
  forgejoToken?: string;
  forgejoInstanceUrl?: string;
  fgApiToken?: string;
  fgApiUrl?: string;
  maxPerRun?: number;
}

export interface TrackDeploymentsResult {
  scanned: number;
  finalized: number;
  pending: number;
  items: { pr: string; outcome: string; detail?: string }[];
}

interface DeployTracking {
  final?: boolean;
  outcome?: string;
  mergeSha?: string;
  checkedAt?: string;
  details?: DeploySummary["details"];
}

export async function trackDeployments(
  cfg: TrackDeploymentsConfig,
): Promise<TrackDeploymentsResult> {
  const result: TrackDeploymentsResult = { scanned: 0, finalized: 0, pending: 0, items: [] };
  if (!cfg.forgejoToken) return result;
  const instanceUrl = cfg.forgejoInstanceUrl ?? "https://git.forgegraf.com";
  const maxPerRun = cfg.maxPerRun ?? 20;

  const since = new Date(Date.now() - DEPLOY_WINDOW_MS).toISOString();
  const merged = await db
    .select({
      id: pullRequests.id,
      number: pullRequests.number,
      owner: pullRequests.remoteOwner,
      repo: pullRequests.remoteName,
      url: pullRequests.url,
      mergedAt: pullRequests.mergedAt,
      workItemId: chatConversations.workItemId,
    })
    .from(pullRequests)
    .innerJoin(chatConversations, eq(chatConversations.id, pullRequests.sessionId))
    .where(
      and(
        eq(pullRequests.status, "merged"),
        eq(pullRequests.provider, "gitea"),
        isNotNull(chatConversations.workItemId),
        gt(pullRequests.mergedAt, since),
      ),
    )
    .orderBy(desc(pullRequests.mergedAt))
    .limit(maxPerRun * 3);

  for (const pr of merged) {
    if (result.scanned >= maxPerRun) break;
    if (!pr.workItemId) continue;
    const label = `${pr.owner}/${pr.repo}#${pr.number}`;

    const item = await db.query.workItems.findFirst({
      where: eq(workItems.id, pr.workItemId),
      columns: { id: true, sourceMetadata: true },
    });
    if (!item) continue;
    const meta = { ...item.sourceMetadata } as Record<string, unknown>;
    const tracking = (meta.deployTracking ?? {}) as DeployTracking;
    if (tracking.final) continue;
    result.scanned++;

    try {
      const mergeSha = await fetchMergeSha(instanceUrl, cfg.forgejoToken, pr.owner, pr.repo, pr.number);
      if (!mergeSha) {
        result.items.push({ pr: label, outcome: "skipped", detail: "no merge sha" });
        continue;
      }
      const [actionRuns, fgDeployments] = await Promise.all([
        fetchActionRuns(instanceUrl, cfg.forgejoToken, pr.owner, pr.repo),
        cfg.fgApiToken
          ? fetchFgDeployments(cfg, instanceUrl, cfg.forgejoToken, pr.owner, pr.repo)
          : Promise.resolve([] as FgDeploymentEvidence[]),
      ]);
      const summary = summarizeDeployEvidence({ mergeSha, actionRuns, fgDeployments });

      const mergedAgeMs = pr.mergedAt ? Date.now() - new Date(pr.mergedAt).getTime() : 0;
      const nextTracking: DeployTracking = {
        ...tracking,
        mergeSha,
        outcome: summary.outcome,
        checkedAt: new Date().toISOString(),
        details: summary.details,
      };

      if (summary.outcome === "pending" || (summary.outcome === "none" && mergedAgeMs < DEPLOY_GRACE_MS)) {
        result.pending++;
        await saveTracking(item.id, meta, nextTracking);
        result.items.push({ pr: label, outcome: summary.outcome });
        continue;
      }

      nextTracking.final = true;
      // Mark final BEFORE the side effects so a tracker hiccup can't cause a
      // comment storm on later ticks.
      await saveTracking(item.id, meta, nextTracking);

      if (summary.outcome === "success" || summary.outcome === "failure") {
        const text = summary.details
          .map((d) => `${d.label} (${d.source}): ${d.status}${d.note ? ` — ${d.note}` : ""}${d.url ? ` ${d.url}` : ""}`)
          .join(" · ");
        await db.insert(workItemArtifacts).values({
          workItemId: item.id,
          producerType: "bob",
          producerId: "deploy-tracker",
          artifactType: "build",
          artifactRole: "deployment",
          title: summary.outcome === "success" ? "Deployed" : "Deploy failed",
          summary: text,
          url: summary.details.find((d) => d.url)?.url ?? pr.url,
          metadata: { mergeSha, details: summary.details, pr: pr.url },
        });
        await mirrorWorkItemEvent(
          db,
          item.id,
          summary.outcome === "success"
            ? { kind: "deployed", summary: text }
            : { kind: "deploy_failed", summary: text },
        );
      }
      result.finalized++;
      result.items.push({ pr: label, outcome: summary.outcome });
    } catch (err) {
      result.items.push({
        pr: label,
        outcome: "error",
        detail: err instanceof Error ? err.message.slice(0, 160) : String(err).slice(0, 160),
      });
      console.error(`[deploy-track] ${label} failed:`, err);
    }
  }

  return result;
}

async function saveTracking(
  workItemId: string,
  meta: Record<string, unknown>,
  tracking: DeployTracking,
): Promise<void> {
  await db
    .update(workItems)
    .set({ sourceMetadata: { ...meta, deployTracking: tracking } })
    .where(eq(workItems.id, workItemId));
}

// ---------------------------------------------------------------------------
// Evidence sources
// ---------------------------------------------------------------------------

async function forgejo<T>(instanceUrl: string, token: string, path: string): Promise<T> {
  const res = await fetch(`${instanceUrl}/api/v1${path}`, {
    headers: { Authorization: `token ${token}` },
  });
  if (!res.ok) throw new Error(`Forgejo ${path} → ${res.status}`);
  return (await res.json()) as T;
}

async function fetchMergeSha(
  instanceUrl: string,
  token: string,
  owner: string,
  repo: string,
  number: number,
): Promise<string | null> {
  const pr = await forgejo<{ merge_commit_sha?: string | null; merged_commit_sha?: string | null }>(
    instanceUrl,
    token,
    `/repos/${owner}/${repo}/pulls/${number}`,
  );
  return pr.merge_commit_sha ?? pr.merged_commit_sha ?? null;
}

async function fetchActionRuns(
  instanceUrl: string,
  token: string,
  owner: string,
  repo: string,
): Promise<ActionRunEvidence[]> {
  try {
    const data = await forgejo<{
      workflow_runs?: { name?: string; status?: string; head_sha?: string; html_url?: string; url?: string }[];
    }>(instanceUrl, token, `/repos/${owner}/${repo}/actions/tasks?limit=50`);
    return (data.workflow_runs ?? []).map((r) => ({
      name: r.name ?? "",
      status: r.status ?? "",
      headSha: r.head_sha ?? "",
      url: r.html_url ?? r.url,
    }));
  } catch {
    // Actions may be disabled for the repo — not an error for tracking.
    return [];
  }
}

/** Resolve the ForgeGraph app bound to a repo via its `.forgegraph.yaml`. */
async function resolveFgAppSlug(
  instanceUrl: string,
  token: string,
  owner: string,
  repo: string,
): Promise<string | null> {
  try {
    const file = await forgejo<{ content?: string }>(
      instanceUrl,
      token,
      `/repos/${owner}/${repo}/contents/.forgegraph.yaml`,
    );
    if (!file.content) return null;
    const text = atob(file.content.replace(/\n/g, ""));
    const m = /^\s*app:\s*["']?([A-Za-z0-9._-]+)["']?\s*$/m.exec(text);
    return m?.[1] ?? null;
  } catch {
    return null;
  }
}

async function fetchFgDeployments(
  cfg: TrackDeploymentsConfig,
  instanceUrl: string,
  forgejoToken: string,
  owner: string,
  repo: string,
): Promise<FgDeploymentEvidence[]> {
  const slug = await resolveFgAppSlug(instanceUrl, forgejoToken, owner, repo);
  if (!slug) return [];
  const base = cfg.fgApiUrl ?? "https://forgegraf.com";
  const headers = { Authorization: `Bearer ${cfg.fgApiToken}` };
  try {
    const [appRes, depRes] = await Promise.all([
      fetch(`${base}/api/fg/apps/${slug}`, { headers }),
      fetch(`${base}/api/fg/deploy?appSlug=${encodeURIComponent(slug)}`, { headers }),
    ]);
    if (!depRes.ok) return [];
    const stages = new Map<string, string>();
    if (appRes.ok) {
      const app = (await appRes.json()) as { stages?: { id: string; name: string }[] };
      for (const s of app.stages ?? []) stages.set(s.id, s.name);
    }
    const data = (await depRes.json()) as {
      deployments?: { commitSha: string | null; status: string; stageId?: string; failureReason?: string | null; id: string }[];
    };
    return (data.deployments ?? []).map((d) => ({
      commitSha: d.commitSha,
      status: d.status,
      stage: d.stageId ? (stages.get(d.stageId) ?? d.stageId.slice(0, 8)) : null,
      failureReason: d.failureReason ?? null,
      url: `${base}/apps/${slug}/deployments/${d.id}`,
    }));
  } catch {
    return [];
  }
}
