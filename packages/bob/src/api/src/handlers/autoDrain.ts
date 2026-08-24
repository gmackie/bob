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
import { mirrorWorkItemEvent } from "../services/tracker/trackerMirror.js";
import type { AgentHealthVerdict } from "../services/automation/agentHealthRouter.js";
import { assessAgentHealth, chooseAgent } from "../services/automation/agentHealthRouter.js";
import { paceDailyBudget } from "../services/health/pacing.js";

// Sessions actively holding a runner execution slot. Mirrors the runner's own
// busy check (its activeSessions map) — NOT "idle", which means the agent
// finished its turn and isn't consuming compute (and old idle sessions linger).
const ACTIVE_SESSION_STATUSES = [
  "pending",
  "provisioning",
  "starting",
  "running",
  // Paused awaiting a human decision — still active (the run isn't dead).
  "blocked",
  "stopping",
  // Lease expired: contact lost, process fate unknown — still active.
  "host_unknown",
];

// Work-item statuses the driver will pick up and dispatch. "ready" is the
// explicit/promoted queue; "todo" is planned work — included so the driver
// stays fed without a separate todo→ready promoter (which doesn't exist).
// "backlog" is intentionally excluded so it remains a manual staging gate.
const DISPATCHABLE_STATUSES = ["ready", "todo"];

// Rotate dispatches across providers to spread rate limits and throughput.
const AGENT_ROTATION = ["claude", "codex", "grok", "cursor"];

export interface AutoDrainOptions {
  /** Fallback max simultaneously-running sessions when no DB config row exists. */
  concurrency: number;
  /** Fallback max task runs per calendar day when no DB config row exists. */
  dailyCap: number;
  /** Only rotate through these agents (defaults to the full rotation). */
  agents?: string[];
  /**
   * Skip agents whose recent sessions are failing hard (expired auth, rate
   * limit). Default on; the plain rotation is the fallback when every agent
   * looks unhealthy. See services/automation/agentHealthRouter.
   */
  healthRouting?: boolean;
  /** Window for the health assessment. Default 2h. */
  healthWindowMs?: number;
  /** Spread the daily cap across the day instead of spending it first-come. Default on. */
  pacing?: boolean;
  /** Runs allowed above the pro-rata line (default = concurrency). */
  burst?: number;
}

function minuteOfDayUtc(d: Date): number {
  return d.getUTCHours() * 60 + d.getUTCMinutes();
}

/**
 * Resolve the live driver config: the single-row auto_drain_config table wins
 * (so the cap/concurrency/on-off can change without a redeploy), falling back
 * to the caller's env-var defaults when the row is absent.
 */
async function resolveConfig(
  fallback: AutoDrainOptions,
): Promise<{ enabled: boolean; concurrency: number; dailyCap: number; disabledAgents: string[] }> {
  try {
    const row = await db.query.autoDrainConfig.findFirst();
    if (row) {
      return {
        enabled: row.enabled,
        concurrency: row.concurrency,
        dailyCap: row.dailyCap,
        disabledAgents: row.disabledAgents,
      };
    }
  } catch {
    // table missing / query error → use env defaults
  }
  return {
    enabled: true,
    concurrency: fallback.concurrency,
    dailyCap: fallback.dailyCap,
    disabledAgents: [],
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
  const cfg = await resolveConfig(opts);
  // Rotation = configured list minus the agents a human pulled via the cockpit
  // (persisted on auto_drain_config; the transient health gate applies on top).
  const configured = opts.agents?.length ? opts.agents : AGENT_ROTATION;
  const manuallyDisabled = new Set(cfg.disabledAgents);
  const filtered = configured.filter((a) => !manuallyDisabled.has(a));
  const agents = filtered.length ? filtered : configured;

  if (!cfg.enabled) {
    return { dispatched: 0, running: 0, dispatchedToday: 0, items: [], reason: "disabled" };
  }

  const runningRows = await db
    .select({ running: sql<number>`count(*)::int` })
    .from(chatConversations)
    .where(inArray(chatConversations.status, ACTIVE_SESSION_STATUSES));
  const running = runningRows[0]?.running ?? 0;

  // Count only EXECUTE runs against the daily cap. Review/repair sessions
  // also insert task_runs (run_phase 'review'/'repair') and are already
  // bounded by their own per-tick budgets in autoMergeReview — letting them
  // eat the dispatch budget meant a busy review/repair morning starved new
  // work entirely (45 "runs" by 07:40 on 2026-08-21, only 29 of them real).
  const todayRows = await db
    .select({ today: sql<number>`count(*)::int` })
    .from(taskRuns)
    .where(
      sql`${taskRuns.createdAt} >= date_trunc('day', now())
        and coalesce(${taskRuns.runPhase}, 'execute') = 'execute'`,
    );
  const today = todayRows[0]?.today ?? 0;

  const freeSlots = Math.max(0, cfg.concurrency - running);
  const remainingToday = Math.max(0, cfg.dailyCap - today);

  // Spend the daily cap as a RATE across the day rather than a kill switch:
  // a busy morning narrows the pipe to a trickle instead of going dark until
  // midnight. The cap is still the hard ceiling. See services/health/pacing.
  const pacing =
    opts.pacing !== false
      ? paceDailyBudget({
          dailyCap: cfg.dailyCap,
          executeToday: today,
          minuteOfDay: minuteOfDayUtc(new Date()),
          burst: opts.burst ?? cfg.concurrency,
        })
      : { allowance: remainingToday, earned: cfg.dailyCap, pacingBinds: false };
  const budget = Math.min(freeSlots, remainingToday, pacing.allowance);

  const base = { running, dispatchedToday: today, items: [] as AutoDrainResult["items"] };
  if (budget <= 0) {
    return {
      ...base,
      dispatched: 0,
      reason:
        freeSlots <= 0
          ? "no free slots"
          : remainingToday <= 0
            ? "daily cap reached"
            : `paced (${today}/${pacing.earned} earned so far today)`,
    };
  }

  // Dispatch both explicitly-readied and planned ("todo") tasks. Nothing in the
  // system promotes todo→ready automatically, so gating on "ready" alone drained
  // the queue to zero and idled Bob for a day once the hand-seeded ready items
  // ran out. Treating "todo" as dispatchable keeps the driver self-sustaining as
  // long as there's planned work; "ready" still sorts first so anything a human
  // explicitly promoted jumps the queue. ("backlog" stays a manual gate.)
  // Oldest first within each tier; over-fetch for project round-robin fairness.
  const ready = await db.query.workItems.findMany({
    where: and(
      inArray(workItems.status, DISPATCHABLE_STATUSES),
      eq(workItems.kind, "task"),
    ),
    orderBy: [
      sql`case when ${workItems.status} = 'ready' then 0 else 1 end`,
      asc(workItems.queueSortOrder),
      asc(workItems.createdAt),
    ],
    limit: budget * 4,
  });
  if (ready.length === 0) {
    return { ...base, dispatched: 0, reason: "no dispatchable items" };
  }

  const picked = pickAcrossProjects(ready, budget);

  // Health-gate the rotation on recent outcomes so a provider with dead auth
  // or an exhausted quota stops receiving dispatches without a human editing
  // BOB_AUTO_DRAIN_AGENTS (codex and claude each burned a quarter of a day's
  // dispatches that way on 2026-08-21).
  let verdicts: AgentHealthVerdict[] = agents.map((agent) => ({ agent, healthy: true, reason: "health routing off" }));
  if (opts.healthRouting !== false) {
    try {
      const windowMs = opts.healthWindowMs ?? 2 * 60 * 60 * 1000;
      const since = new Date(Date.now() - windowMs).toISOString();
      const rows = await db
        .select({
          agent: chatConversations.agentType,
          completed: sql<number>`count(*) filter (where ${chatConversations.status} = 'completed')::int`,
          errored: sql<number>`count(*) filter (where ${chatConversations.status} in ('error','failed'))::int`,
        })
        .from(chatConversations)
        .where(sql`${chatConversations.createdAt} >= ${since}`)
        .groupBy(chatConversations.agentType);
      verdicts = assessAgentHealth(agents, rows.map((r) => ({ agent: r.agent, completed: r.completed, errored: r.errored })));
      const unhealthy = verdicts.filter((v) => !v.healthy);
      if (unhealthy.length && unhealthy.length < agents.length) {
        console.warn(
          `[auto-drain] health routing skipping ${unhealthy.map((v) => `${v.agent} (${v.reason})`).join(", ")}`,
        );
      }
    } catch (err) {
      console.warn("[auto-drain] health assessment failed; using plain rotation:", err);
    }
  }
  const { executeTask } = await import("@bob/execution/runtime/taskExecutor");

  const dispatchedItems: AutoDrainResult["items"] = [];
  for (const wi of picked) {
    try {
      // Guard against a concurrent dispatch: only proceed if still dispatchable.
      const claimed = await db
        .update(workItems)
        .set({ status: "in_progress" })
        .where(
          and(
            eq(workItems.id, wi.id),
            inArray(workItems.status, DISPATCHABLE_STATUSES),
          ),
        )
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

      // Prefer a per-item agent override, else health-gated rotation.
      const agentType =
        wi.agentTypeOverride ??
        chooseAgent(agents, verdicts, today + dispatchedItems.length).agent;

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
      // Mirror the claim to the tracker (Kanbanger card → In Progress +
      // comment). Best-effort; the mirror never blocks dispatch.
      await mirrorWorkItemEvent(db, wi.id, { kind: "claimed", agentType }).catch(
        () => undefined,
      );
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
