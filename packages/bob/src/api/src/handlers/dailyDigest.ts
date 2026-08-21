// Daily digest of the autonomous loop.
//
// Once per UTC day (first cron tick at/after BOB_DIGEST_HOUR_UTC) collect the
// last 24h of loop metrics and post them where a human will see them:
//   1. a comment on the pinned "📊 Bob daily digest" Kanbanger issue — created
//      on first run (bob-managed label so the webhook importer skips it; the
//      pull sync will still mirror it as a backlog item, which is how we find
//      it again and where we keep `lastDigestDate`), and
//   2. a Bob in-app notification for the workspace owner.
// Idempotent per day via work_items.source_metadata.digest.lastDate on the
// pinned issue's mirror row. Best-effort; never throws into the cron.

import { and, eq, gt, inArray, sql } from "@bob/db";
import { db } from "@bob/db/client";
import {
  chatConversations,
  notifications,
  pullRequests,
  taskRuns,
  workItemArtifacts,
  workItems,
  workspaceIntegrations,
  workspaceMembers,
} from "@bob/db/schema";
import { LinearClient } from "@linear/sdk";

import { digestNotes, renderDigest  } from "../services/digest/renderDigest.js";
import type {DigestMetrics} from "../services/digest/renderDigest.js";

const PINNED_TITLE = "📊 Bob daily digest";

export interface DailyDigestResult {
  posted: boolean;
  reason?: string;
  date?: string;
  text?: string;
}

export async function dailyDigest(opts: {
  hourUtc?: number;
  dailyCap?: number;
  now?: Date;
  force?: boolean;
}): Promise<DailyDigestResult> {
  const now = opts.now ?? new Date();
  const hour = opts.hourUtc ?? 13;
  const today = now.toISOString().slice(0, 10);
  if (!opts.force && now.getUTCHours() < hour) return { posted: false, reason: "before digest hour" };

  const integ = await db.query.workspaceIntegrations.findFirst({
    where: and(eq(workspaceIntegrations.provider, "linear"), eq(workspaceIntegrations.enabled, true)),
  });
  if (!integ?.apiKey) return { posted: false, reason: "no tracker integration" };

  // Pinned issue's mirror row (imported by the pull sync) holds the state.
  const pinned = await db.query.workItems.findFirst({
    where: and(
      eq(workItems.externalProvider, "linear"),
      eq(workItems.title, PINNED_TITLE),
    ),
    columns: { id: true, externalId: true, sourceMetadata: true },
  });

  const client = new LinearClient({
    apiKey: integ.apiKey,
    ...(integ.linearApiUrl ? { apiUrl: integ.linearApiUrl } : {}),
  });

  if (!pinned) {
    // Bootstrap: create the pinned issue; the next pull sync mirrors it and the
    // following digest tick will post to it.
    if (!opts.force) {
      const team = integ.linearTeamId;
      if (!team) return { posted: false, reason: "no team id to create pinned issue" };
      await client.createIssue({
        teamId: team,
        title: PINNED_TITLE,
        description:
          "Bob posts a daily summary of the autonomous loop here as comments. Keep this card in Backlog; Bob never works it.",
      });
      return { posted: false, reason: "created pinned digest issue; will post after next sync" };
    }
    return { posted: false, reason: "pinned issue not mirrored yet" };
  }

  const meta = { ...pinned.sourceMetadata } as Record<string, unknown>;
  const digestMeta = (meta.digest ?? {}) as { lastDate?: string };
  if (!opts.force && digestMeta.lastDate === today) return { posted: false, reason: "already posted today", date: today };

  const metrics = await collectMetrics(today, opts.dailyCap ?? 40);
  const text = renderDigest(metrics);

  // Mark first so a tracker hiccup can't double-post tomorrow's tick.
  await db
    .update(workItems)
    .set({ sourceMetadata: { ...meta, digest: { lastDate: today } } })
    .where(eq(workItems.id, pinned.id));

  if (pinned.externalId) {
    await client.createComment({ issueId: pinned.externalId, body: text });
  }

  // In-app notification for the workspace owner.
  const owner = await db.query.workspaceMembers.findFirst({
    where: eq(workspaceMembers.workspaceId, integ.workspaceId),
    columns: { userId: true },
    orderBy: (m, { asc }) => [asc(m.joinedAt)],
  });
  if (owner) {
    await db.insert(notifications).values({
      userId: owner.userId,
      type: "batch_completed",
      title: `Bob daily digest — ${today}`,
      body: text.slice(0, 2000),
      url: `/work-items/${pinned.id}`,
    });
  }

  return { posted: true, date: today, text };
}

async function collectMetrics(date: string, capTotal: number): Promise<DigestMetrics> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const [runs] = await db
    .select({
      dispatched: sql<number>`count(*) filter (where coalesce(${taskRuns.runPhase},'execute')='execute')::int`,
      reviews: sql<number>`count(*) filter (where ${taskRuns.runPhase}='review')::int`,
      repairs: sql<number>`count(*) filter (where ${taskRuns.runPhase}='repair')::int`,
      capUsed: sql<number>`count(*) filter (where coalesce(${taskRuns.runPhase},'execute')='execute' and ${taskRuns.createdAt} >= date_trunc('day', now()))::int`,
    })
    .from(taskRuns)
    .where(gt(taskRuns.createdAt, since));

  const [prs] = await db
    .select({
      opened: sql<number>`count(*) filter (where ${pullRequests.createdAt} >= ${since})::int`,
      merged: sql<number>`count(*) filter (where ${pullRequests.mergedAt} >= ${since})::int`,
      closed: sql<number>`count(*) filter (where ${pullRequests.closedAt} >= ${since} and ${pullRequests.status}='closed')::int`,
    })
    .from(pullRequests);

  const [deploys] = await db
    .select({
      ok: sql<number>`count(*) filter (where ${workItemArtifacts.title}='Deployed')::int`,
      failed: sql<number>`count(*) filter (where ${workItemArtifacts.title}='Deploy failed')::int`,
    })
    .from(workItemArtifacts)
    .where(and(eq(workItemArtifacts.producerId, "deploy-tracker"), gt(workItemArtifacts.createdAt, since)));

  const sessions = await db
    .select({
      agent: chatConversations.agentType,
      status: chatConversations.status,
      n: sql<number>`count(*)::int`,
    })
    .from(chatConversations)
    .where(gt(chatConversations.createdAt, since))
    .groupBy(chatConversations.agentType, chatConversations.status);

  const queueRows = await db
    .select({ status: workItems.status, n: sql<number>`count(*)::int` })
    .from(workItems)
    .groupBy(workItems.status);
  const q = Object.fromEntries(queueRows.map((r) => [r.status, r.n])) as Record<string, number>;

  // Lead time: first claim (earliest session for the work item) → merge.
  const leads = await db
    .select({
      minutes: sql<number>`extract(epoch from (${pullRequests.mergedAt}::timestamptz - (
        select min(c2.created_at) from chat_conversations c2 where c2.work_item_id = ${chatConversations.workItemId}
      )::timestamptz)) / 60`,
    })
    .from(pullRequests)
    .innerJoin(chatConversations, eq(chatConversations.id, pullRequests.sessionId))
    .where(and(gt(pullRequests.mergedAt, since), inArray(pullRequests.status, ["merged"])));
  const leadVals = leads.map((l) => Number(l.minutes)).filter((v) => Number.isFinite(v) && v >= 0).sort((a, b) => a - b);
  const mid = leadVals[Math.floor(leadVals.length / 2)];
  const medianLeadMinutes = mid === undefined ? null : Math.round(mid);

  const byAgent = new Map<string, { completed: number; errored: number }>();
  let sessionsCompleted = 0, sessionsErrored = 0, sessionsBlocked = 0;
  for (const s of sessions) {
    const key = s.agent;
    const a = byAgent.get(key) ?? { completed: 0, errored: 0 };
    if (s.status === "completed") { a.completed += s.n; sessionsCompleted += s.n; }
    else if (s.status === "error" || s.status === "failed") { a.errored += s.n; sessionsErrored += s.n; }
    else if (s.status === "blocked") sessionsBlocked += s.n;
    byAgent.set(key, a);
  }
  const agents = [...byAgent.entries()].map(([agent, v]) => ({ agent, ...v })).sort((x, y) => y.completed - x.completed);

  const partial: Omit<DigestMetrics, "notes"> = {
    date,
    dispatched: runs?.dispatched ?? 0,
    prsOpened: prs?.opened ?? 0,
    prsMerged: prs?.merged ?? 0,
    prsClosed: prs?.closed ?? 0,
    deploysOk: deploys?.ok ?? 0,
    deploysFailed: deploys?.failed ?? 0,
    sessionsCompleted,
    sessionsErrored,
    sessionsBlocked,
    reviewsRun: runs?.reviews ?? 0,
    repairsRun: runs?.repairs ?? 0,
    queue: {
      todo: (q.todo ?? 0) + (q.ready ?? 0),
      backlog: q.backlog ?? 0,
      inProgress: q.in_progress ?? 0,
      inReview: q.in_review ?? 0,
      blocked: q.blocked ?? 0,
      done: q.done ?? 0,
    },
    medianLeadMinutes,
    capUsed: runs?.capUsed ?? 0,
    capTotal,
    agents,
  };
  return { ...partial, notes: digestNotes(partial) };
}
