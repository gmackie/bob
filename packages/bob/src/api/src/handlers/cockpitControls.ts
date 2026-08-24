// Cockpit V2 controls — the eight mutations behind ops mode (and mobile
// approve/deny/steering, which calls the same procedures).
//
// Every control: (1) requires the caller to be a workspace OWNER, (2) writes a
// cockpit_audit row (who pressed what, on what) so human interventions render
// in the cockpit timeline as first-class history, (3) reuses an existing
// mechanism — nothing here invents a new way to mutate the loop.

import { TRPCError } from "@trpc/server";
import { and, eq } from "@bob/db";
import { db } from "@bob/db/client";
import {
  autoDrainConfig,
  cockpitAudit,
  pullRequests,
  workItems,
  workspaceMembers,
} from "@bob/db/schema";

import { KNOWN_AGENTS } from "../services/linear/agentLabel.js";
import { queueOrderForPriority } from "../services/linear/priority.js";
import { mirrorWorkItemEvent } from "../services/tracker/trackerMirror.js";
import { createProviderClient, getConnection } from "../services/git/providerConnectionService.js";
import type { GitProvider } from "../services/git/providers/types.js";

export interface ControlCtx {
  userId: string;
}

/** Owner gate: the caller must own at least one workspace. */
async function assertOwner(userId: string): Promise<void> {
  const m = await db.query.workspaceMembers.findFirst({
    where: and(eq(workspaceMembers.userId, userId), eq(workspaceMembers.role, "owner")),
    columns: { id: true },
  });
  if (!m) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Cockpit controls are owner-only." });
  }
}

async function audit(userId: string, action: string, target: string | null, payload: Record<string, unknown> = {}): Promise<void> {
  await db.insert(cockpitAudit).values({ userId, action, target, payload }).catch((err) => {
    console.error(`[cockpit] audit write failed for ${action}:`, err);
  });
}

// ---------------------------------------------------------------------------

/** Stop a running session (the runner reports it interrupted, not failed). */
export async function controlStopSession(ctx: ControlCtx, input: { sessionId: string }) {
  await assertOwner(ctx.userId);
  const { sessionStop } = await import("./session.js");
  const result = await sessionStop({ db, userId: ctx.userId }, { id: input.sessionId });
  await audit(ctx.userId, "stop_session", input.sessionId);
  return result;
}

/** Re-queue a work item: back to todo with attempts++ (same path the reaper uses). */
export async function controlRetryItem(ctx: ControlCtx, input: { workItemId: string }) {
  await assertOwner(ctx.userId);
  const item = await db.query.workItems.findFirst({
    where: eq(workItems.id, input.workItemId),
    columns: { id: true, status: true, sourceMetadata: true },
  });
  if (!item) throw new TRPCError({ code: "NOT_FOUND", message: "work item not found" });
  const meta = item.sourceMetadata;
  const attempts = (Number(meta.attempts) || 0) + 1;
  await mirrorWorkItemEvent(db, item.id, { kind: "requeued", reason: "retried from cockpit", attempt: attempts });
  await audit(ctx.userId, "retry_item", input.workItemId, { fromStatus: item.status, attempt: attempts });
  return { status: "todo", attempts };
}

/** Move an item up/down the queue immediately AND mirror priority to the tracker via the next sync. */
export async function controlBumpPriority(ctx: ControlCtx, input: { workItemId: string; priority: 0 | 1 | 2 | 3 | 4 }) {
  await assertOwner(ctx.userId);
  const queueSortOrder = queueOrderForPriority(input.priority);
  const res = await db
    .update(workItems)
    .set({ queueSortOrder })
    .where(eq(workItems.id, input.workItemId))
    .returning({ id: workItems.id, externalId: workItems.externalId, externalProvider: workItems.externalProvider });
  const row = res[0];
  if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "work item not found" });
  // Tracker mirror: set the card's priority too so the sync doesn't undo this.
  if (row.externalProvider === "linear" && row.externalId) {
    try {
      const { LinearClient } = await import("@linear/sdk");
      const integ = await db.query.workspaceIntegrations.findFirst({
        where: eq((await import("@bob/db/schema")).workspaceIntegrations.provider, "linear"),
      });
      if (integ?.apiKey) {
        const client = new LinearClient({ apiKey: integ.apiKey, ...(integ.linearApiUrl ? { apiUrl: integ.linearApiUrl } : {}) });
        await client.updateIssue(row.externalId, { priority: input.priority });
      }
    } catch (err) {
      console.warn("[cockpit] tracker priority mirror failed:", err);
    }
  }
  await audit(ctx.userId, "bump_priority", input.workItemId, { priority: input.priority, queueSortOrder });
  return { queueSortOrder };
}

/** Pause / resume autonomous dispatch. */
export async function controlSetDispatchEnabled(ctx: ControlCtx, input: { enabled: boolean }) {
  await assertOwner(ctx.userId);
  await db
    .insert(autoDrainConfig)
    .values({ id: 1, enabled: input.enabled })
    .onConflictDoUpdate({ target: autoDrainConfig.id, set: { enabled: input.enabled } });
  await audit(ctx.userId, input.enabled ? "resume_dispatch" : "pause_dispatch", null);
  return { enabled: input.enabled };
}

/** Tune the daily cap / concurrency (the pacing spreads the cap across the day). */
export async function controlSetBudget(ctx: ControlCtx, input: { dailyCap?: number; concurrency?: number }) {
  await assertOwner(ctx.userId);
  const set: Record<string, number> = {};
  if (input.dailyCap != null) set.dailyCap = input.dailyCap;
  if (input.concurrency != null) set.concurrency = input.concurrency;
  if (!Object.keys(set).length) throw new TRPCError({ code: "BAD_REQUEST", message: "nothing to set" });
  await db
    .insert(autoDrainConfig)
    .values({ id: 1, ...set })
    .onConflictDoUpdate({ target: autoDrainConfig.id, set });
  await audit(ctx.userId, "set_budget", null, set);
  return set;
}

/** Pull an agent from rotation (persists) or restore it. The health gate stays automatic on top. */
export async function controlSetAgentEnabled(ctx: ControlCtx, input: { agent: string; enabled: boolean }) {
  await assertOwner(ctx.userId);
  if (!(KNOWN_AGENTS as readonly string[]).includes(input.agent)) {
    throw new TRPCError({ code: "BAD_REQUEST", message: `unknown agent ${input.agent}` });
  }
  const cfg = await db.query.autoDrainConfig.findFirst();
  const current = new Set((cfg?.disabledAgents ?? []));
  if (input.enabled) current.delete(input.agent);
  else current.add(input.agent);
  const disabledAgents = [...current];
  await db
    .insert(autoDrainConfig)
    .values({ id: 1, disabledAgents })
    .onConflictDoUpdate({ target: autoDrainConfig.id, set: { disabledAgents } });
  await audit(ctx.userId, input.enabled ? "restore_agent" : "pull_agent", input.agent, { disabledAgents });
  return { disabledAgents };
}

/** Dispatch a review session for a PR right now (skips the cron wait). */
export async function controlTriggerReview(ctx: ControlCtx, input: { pullRequestId: string }) {
  await assertOwner(ctx.userId);
  const pr = await db.query.pullRequests.findFirst({ where: eq(pullRequests.id, input.pullRequestId) });
  if (!pr) throw new TRPCError({ code: "NOT_FOUND", message: "PR not found" });
  if (!pr.repositoryId) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "PR has no linked repository" });
  const connection = await getConnection(pr.userId, pr.provider as GitProvider, pr.instanceUrl);
  const token = connection?.accessToken ?? process.env.BOB_FORGEJO_TOKEN;
  if (!token) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "no git credentials for this PR" });
  const client = createProviderClient(pr.provider as GitProvider, token, pr.instanceUrl);
  const remote = await client.getPullRequest(pr.remoteOwner, pr.remoteName, pr.number);
  if (!remote.headSha) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "no head SHA" });
  const { dispatchReviewSession } = await import("@bob/execution/runtime/taskExecutor");
  const result = await dispatchReviewSession(pr.userId, {
    pullRequestId: pr.id,
    repositoryId: pr.repositoryId,
    remoteOwner: pr.remoteOwner,
    remoteName: pr.remoteName,
    number: pr.number,
    instanceUrl: pr.instanceUrl,
    headSha: remote.headSha,
    headBranch: pr.headBranch,
    title: pr.title,
    body: pr.body,
    reviewToken: process.env.BOB_REVIEW_FORGEJO_TOKEN,
  });
  await audit(ctx.userId, "trigger_review", `${pr.remoteOwner}/${pr.remoteName}#${pr.number}`);
  return { dispatched: !!result, sessionId: result?.sessionId ?? null };
}

/** Post a review AS THE SIGNED-IN OWNER (never as bob-reviewer). */
export async function controlReviewPr(
  ctx: ControlCtx,
  input: { pullRequestId: string; verdict: "APPROVE" | "REQUEST_CHANGES"; body?: string },
) {
  await assertOwner(ctx.userId);
  const pr = await db.query.pullRequests.findFirst({ where: eq(pullRequests.id, input.pullRequestId) });
  if (!pr) throw new TRPCError({ code: "NOT_FOUND", message: "PR not found" });
  const connection = await getConnection(ctx.userId, pr.provider as GitProvider, pr.instanceUrl);
  if (!connection?.accessToken) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "connect your git account first — cockpit reviews post as YOU, not the bot",
    });
  }
  const client = createProviderClient(pr.provider as GitProvider, connection.accessToken, pr.instanceUrl);
  if (!client.createPullRequestReview) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "provider lacks review support" });
  await client.createPullRequestReview(
    pr.remoteOwner,
    pr.remoteName,
    pr.number,
    input.verdict,
    input.body ?? (input.verdict === "APPROVE" ? "Approved from the cockpit." : "Changes requested from the cockpit."),
  );
  await audit(ctx.userId, input.verdict === "APPROVE" ? "approve_pr" : "reject_pr", `${pr.remoteOwner}/${pr.remoteName}#${pr.number}`, { body: input.body ?? null });
  return { posted: true };
}
