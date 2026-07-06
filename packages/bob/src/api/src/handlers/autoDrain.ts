// Autonomous backlog driver.
//
// The batch-dispatch queue-drain engine (dispatchCheckProgress) only advances
// while a browser holds the dispatch UI open and polls it. This function is the
// server-side driver: called on a schedule (a Cloudflare Cron trigger on the
// bob worker), it dispatches ready work items up to the concurrency cap and a
// daily rate limit, rotating across agents so load spreads over providers.
//
// It reuses executeTask (same path as manual dispatch), so PR automation,
// nudging, and status sync all work unchanged.

import { and, asc, eq, inArray, sql } from "@bob/db";
import { db } from "@bob/db/client";
import {
  chatConversations,
  projects,
  taskRuns,
  workItems,
} from "@bob/db/schema";

import { formatWorkItemIdentifier } from "./workItems";
import { pickAcrossProjects } from "./autoDrain-pick";

// Sessions actively holding a runner execution slot. Mirrors the runner's own
// busy check (its activeSessions map) — NOT "idle", which means the agent
// finished its turn and isn't consuming compute (and old idle sessions linger).
const ACTIVE_SESSION_STATUSES = [
  "pending",
  "provisioning",
  "starting",
  "running",
  "stopping",
];

// Rotate dispatches across providers to spread rate limits and throughput.
const AGENT_ROTATION = ["claude", "codex", "grok", "cursor"];

export interface AutoDrainOptions {
  /** Fallback max simultaneously-running sessions when no DB config row exists. */
  concurrency: number;
  /** Fallback max task runs per calendar day when no DB config row exists. */
  dailyCap: number;
  /** Only rotate through these agents (defaults to the full rotation). */
  agents?: string[];
}

/**
 * Resolve the live driver config: the single-row auto_drain_config table wins
 * (so the cap/concurrency/on-off can change without a redeploy), falling back
 * to the caller's env-var defaults when the row is absent.
 */
async function resolveConfig(
  fallback: AutoDrainOptions,
): Promise<{ enabled: boolean; concurrency: number; dailyCap: number }> {
  try {
    const row = await db.query.autoDrainConfig.findFirst();
    if (row) {
      return {
        enabled: row.enabled,
        concurrency: row.concurrency,
        dailyCap: row.dailyCap,
      };
    }
  } catch {
    // table missing / query error → use env defaults
  }
  return {
    enabled: true,
    concurrency: fallback.concurrency,
    dailyCap: fallback.dailyCap,
  };
}

export interface AutoDrainResult {
  dispatched: number;
  running: number;
  dispatchedToday: number;
  reason?: string;
  items: { id: string; identifier: string; agentType: string }[];
}

export async function autoDrainBacklog(
  opts: AutoDrainOptions,
): Promise<AutoDrainResult> {
  const agents = opts.agents?.length ? opts.agents : AGENT_ROTATION;
  const cfg = await resolveConfig(opts);

  if (!cfg.enabled) {
    return { dispatched: 0, running: 0, dispatchedToday: 0, items: [], reason: "disabled" };
  }

  const runningRows = await db
    .select({ running: sql<number>`count(*)::int` })
    .from(chatConversations)
    .where(inArray(chatConversations.status, ACTIVE_SESSION_STATUSES));
  const running = runningRows[0]?.running ?? 0;

  const todayRows = await db
    .select({ today: sql<number>`count(*)::int` })
    .from(taskRuns)
    .where(sql`${taskRuns.createdAt} >= date_trunc('day', now())`);
  const today = todayRows[0]?.today ?? 0;

  const freeSlots = Math.max(0, cfg.concurrency - running);
  const remainingToday = Math.max(0, cfg.dailyCap - today);
  const budget = Math.min(freeSlots, remainingToday);

  const base = { running, dispatchedToday: today, items: [] as AutoDrainResult["items"] };
  if (budget <= 0) {
    return {
      ...base,
      dispatched: 0,
      reason: freeSlots <= 0 ? "no free slots" : "daily cap reached",
    };
  }

  // Oldest ready tasks first; over-fetch for project round-robin fairness.
  const ready = await db.query.workItems.findMany({
    where: and(eq(workItems.status, "ready"), eq(workItems.kind, "task")),
    orderBy: [asc(workItems.queueSortOrder), asc(workItems.createdAt)],
    limit: budget * 4,
  });
  if (ready.length === 0) {
    return { ...base, dispatched: 0, reason: "no ready items" };
  }

  const picked = pickAcrossProjects(ready, budget);
  const { executeTask } = await import("@bob/execution/runtime/taskExecutor");

  const dispatchedItems: AutoDrainResult["items"] = [];
  for (const wi of picked) {
    try {
      // Guard against a concurrent dispatch: only proceed if still ready.
      const claimed = await db
        .update(workItems)
        .set({ status: "in_progress" })
        .where(and(eq(workItems.id, wi.id), eq(workItems.status, "ready")))
        .returning({ id: workItems.id });
      if (claimed.length === 0) continue; // someone else took it

      const project = wi.projectId
        ? await db.query.projects.findFirst({
            where: eq(projects.id, wi.projectId),
            columns: { key: true },
          })
        : null;
      const identifier =
        wi.externalId ??
        formatWorkItemIdentifier({
          projectKey: project?.key ?? null,
          sequenceNumber: wi.sequenceNumber,
          id: wi.id,
        });

      // Prefer a per-item agent override, else rotate.
      const agentType =
        wi.agentTypeOverride ??
        agents[(today + dispatchedItems.length) % agents.length] ??
        "claude";

      await executeTask(
        wi.ownerUserId,
        {
          id: wi.id,
          identifier,
          title: wi.title,
          description: wi.description,
          workspaceId: wi.workspaceId ?? "",
          projectId: wi.projectId ?? "",
          assigneeId: null,
          labels: [],
          priority: 0,
        },
        { agentType },
      );
      dispatchedItems.push({ id: wi.id, identifier, agentType });
    } catch (err) {
      // Roll the item back to ready so the next tick retries it.
      await db
        .update(workItems)
        .set({ status: "ready" })
        .where(eq(workItems.id, wi.id))
        .catch(() => undefined);
      console.error(`[auto-drain] dispatch failed for ${wi.id}:`, err);
    }
  }

  return {
    running,
    dispatchedToday: today,
    dispatched: dispatchedItems.length,
    items: dispatchedItems,
  };
}
