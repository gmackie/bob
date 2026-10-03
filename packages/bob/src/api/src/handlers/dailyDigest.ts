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

import type { DigestMetrics } from "../services/digest/renderDigest.js";
import { DIGEST_DATE, publishDigest } from "../services/digest/destination.js";
import { digestNotes, renderDigest } from "../services/digest/renderDigest.js";
import { digestStore } from "../services/digest/store.js";
import { digestTracker } from "../services/digest/tracker.js";

export { PINNED_TITLE } from "../services/digest/destination.js";

export interface DailyDigestResult {
  posted: boolean;
  reason?: string;
  date?: string;
  text?: string;
}

/** Newest digest date already posted on the pinned issue (from its comments). */
export function lastPostedDate(
  commentBodies: readonly string[],
): string | null {
  let last: string | null = null;
  for (const body of commentBodies) {
    const m = DIGEST_DATE.exec(body);
    if (m?.[1] && (!last || m[1] > last)) last = m[1];
  }
  return last;
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
  if (!opts.force && now.getUTCHours() < hour)
    return { posted: false, reason: "before digest hour" };

  const integrations = await db.query.workspaceIntegrations.findMany({
    where: and(
      eq(workspaceIntegrations.provider, "linear"),
      eq(workspaceIntegrations.enabled, true),
    ),
  });
  const results: DailyDigestResult[] = [];
  for (const integ of integrations) {
    if (!integ.apiKey || !integ.linearTeamId) continue;
    const apiUrl = integ.linearApiUrl ?? "https://api.linear.app/graphql";
    const scope = JSON.stringify([
      integ.workspaceId,
      apiUrl,
      integ.linearTeamId,
    ]);
    const result = await publishDigest(
      {
        scope,
        workspaceId: integ.workspaceId,
        date: today,
        render: async () =>
          renderDigest(
            await collectMetrics(today, opts.dailyCap ?? 40, integ.workspaceId),
          ),
      },
      digestStore,
      digestTracker({
        apiKey: integ.apiKey,
        apiUrl,
        teamId: integ.linearTeamId,
        retireLocal: async (id) => {
          await db
            .update(workItems)
            .set({ status: "canceled" })
            .where(
              and(
                eq(workItems.workspaceId, integ.workspaceId),
                eq(workItems.externalProvider, "linear"),
                eq(workItems.externalId, id),
              ),
            );
        },
      }),
    );
    if (result.posted && result.text) {
      const owner = await db.query.workspaceMembers.findFirst({
        where: eq(workspaceMembers.workspaceId, integ.workspaceId),
        columns: { userId: true },
        orderBy: (m, { asc }) => [asc(m.joinedAt)],
      });
      if (owner)
        await db
          .insert(notifications)
          .values({
            userId: owner.userId,
            type: "batch_completed",
            title: `Bob daily digest — ${today}`,
            body: result.text.slice(0, 2000),
            url: result.url,
          });
    }
    results.push({ posted: result.posted, date: today, text: result.text });
  }
  return {
    posted: results.some((r) => r.posted),
    date: today,
    reason: results.length ? undefined : "no tracker integration",
    text:
      results
        .filter((r) => r.text)
        .map((r) => r.text)
        .join("\n\n") || undefined,
  };
}

async function collectMetrics(
  date: string,
  capTotal: number,
  workspaceId: string,
): Promise<DigestMetrics> {
  const workspaceItems = db
    .select({ id: workItems.id })
    .from(workItems)
    .where(eq(workItems.workspaceId, workspaceId));
  const workspaceSessions = db
    .select({ id: chatConversations.id })
    .from(chatConversations)
    .where(inArray(chatConversations.workItemId, workspaceItems));
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const [runs] = await db
    .select({
      dispatched: sql<number>`count(*) filter (where coalesce(${taskRuns.runPhase},'execute')='execute')::int`,
      reviews: sql<number>`count(*) filter (where ${taskRuns.runPhase}='review')::int`,
      repairs: sql<number>`count(*) filter (where ${taskRuns.runPhase}='repair')::int`,
      capUsed: sql<number>`count(*) filter (where coalesce(${taskRuns.runPhase},'execute')='execute' and ${taskRuns.createdAt} >= date_trunc('day', now()))::int`,
    })
    .from(taskRuns)
    .where(
      and(
        gt(taskRuns.createdAt, since),
        inArray(taskRuns.workItemId, workspaceItems),
      ),
    );

  const [prs] = await db
    .select({
      opened: sql<number>`count(*) filter (where ${pullRequests.createdAt} >= ${since})::int`,
      merged: sql<number>`count(*) filter (where ${pullRequests.mergedAt} >= ${since})::int`,
      closed: sql<number>`count(*) filter (where ${pullRequests.closedAt} >= ${since} and ${pullRequests.status}='closed')::int`,
    })
    .from(pullRequests)
    .where(inArray(pullRequests.sessionId, workspaceSessions));

  const [deploys] = await db
    .select({
      ok: sql<number>`count(*) filter (where ${workItemArtifacts.title}='Deployed')::int`,
      failed: sql<number>`count(*) filter (where ${workItemArtifacts.title}='Deploy failed')::int`,
    })
    .from(workItemArtifacts)
    .where(
      and(
        eq(workItemArtifacts.producerId, "deploy-tracker"),
        gt(workItemArtifacts.createdAt, since),
        inArray(workItemArtifacts.workItemId, workspaceItems),
      ),
    );

  const sessions = await db
    .select({
      agent: chatConversations.agentType,
      status: chatConversations.status,
      n: sql<number>`count(*)::int`,
    })
    .from(chatConversations)
    .where(
      and(
        gt(chatConversations.createdAt, since),
        inArray(chatConversations.workItemId, workspaceItems),
      ),
    )
    .groupBy(chatConversations.agentType, chatConversations.status);

  const queueRows = await db
    .select({ status: workItems.status, n: sql<number>`count(*)::int` })
    .from(workItems)
    .where(eq(workItems.workspaceId, workspaceId))
    .groupBy(workItems.status);
  const q = Object.fromEntries(queueRows.map((r) => [r.status, r.n])) as Record<
    string,
    number
  >;

  // Lead time: first claim of THIS attempt → merge. An item can have sessions
  // from earlier abandoned attempts weeks back (HABIT-9 had a July run), so
  // only sessions within 7 days before the merge count as this attempt.
  const leads = await db
    .select({
      minutes: sql<number>`extract(epoch from (${pullRequests.mergedAt}::timestamptz - (
        select min(c2.created_at) from chat_conversations c2
         where c2.work_item_id = ${chatConversations.workItemId}
           and c2.created_at::timestamptz > ${pullRequests.mergedAt}::timestamptz - interval '7 days'
      )::timestamptz)) / 60`,
    })
    .from(pullRequests)
    .innerJoin(
      chatConversations,
      eq(chatConversations.id, pullRequests.sessionId),
    )
    .where(
      and(
        gt(pullRequests.mergedAt, since),
        inArray(pullRequests.status, ["merged"]),
        inArray(pullRequests.sessionId, workspaceSessions),
      ),
    );
  const leadVals = leads
    .map((l) => Number(l.minutes))
    .filter((v) => Number.isFinite(v) && v >= 0)
    .sort((a, b) => a - b);
  const mid = leadVals[Math.floor(leadVals.length / 2)];
  const medianLeadMinutes = mid === undefined ? null : Math.round(mid);

  const byAgent = new Map<string, { completed: number; errored: number }>();
  let sessionsCompleted = 0,
    sessionsErrored = 0,
    sessionsBlocked = 0;
  for (const s of sessions) {
    const key = s.agent;
    const a = byAgent.get(key) ?? { completed: 0, errored: 0 };
    if (s.status === "completed") {
      a.completed += s.n;
      sessionsCompleted += s.n;
    } else if (s.status === "error" || s.status === "failed") {
      a.errored += s.n;
      sessionsErrored += s.n;
    } else if (s.status === "blocked") sessionsBlocked += s.n;
    byAgent.set(key, a);
  }
  const agents = [...byAgent.entries()]
    .map(([agent, v]) => ({ agent, ...v }))
    .sort((x, y) => y.completed - x.completed);

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
