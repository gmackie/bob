// Orphaned-claim reconciler.
//
// `reapStuckSessions` reaches a work item through its session, which covers a
// run that started and then died. Two shapes have no session to find:
//
//   - claimed but never dispatched: 275 production items had no run at all
//   - run ended, item never moved: 167 more, every run terminal
//
// Those 454 items read "In Progress" while zero runs were live anywhere, the
// oldest untouched since August. Nothing retracts the claim, so the board
// overstates activity forever and the phone's triage lanes are fiction.
//
// This sweeps those back to `todo` so they can be picked up again. It is
// deliberately conservative: an item is only released when no session and no
// run are active AND it has been quiet past a generous threshold, so a live
// item is never yanked out from under a runner.

import { and, eq, inArray, sql } from "@bob/db";
import { db } from "@bob/db/client";
import { agentRuns, chatConversations, workItems } from "@bob/db/schema";
import { resolveOrphanedClaim } from "../services/dispatch/orphaned-claims.js";
import { mirrorWorkItemEvent } from "../services/tracker/trackerMirror.js";

/** Session statuses that still hold a work item. */
const ACTIVE_SESSION_STATUSES = [
  "pending",
  "provisioning",
  "starting",
  "running",
  "blocked",
  "stopping",
  "host_unknown",
];

/** Run statuses that mean the run is over. */
const TERMINAL_RUN_STATUSES = ["completed", "failed", "interrupted", "cancelled"];

export interface ReconcileOrphanedClaimsOptions {
  /** How long an item may sit untouched before it counts as abandoned. */
  idleMs?: number;
  /** Cap per sweep so one pass cannot rewrite the whole board. */
  limit?: number;
  dryRun?: boolean;
}

export interface ReconcileOrphanedClaimsResult {
  released: number;
  items: { id: string; reason: string }[];
  dryRun: boolean;
}

export async function reconcileOrphanedClaims(
  opts: ReconcileOrphanedClaimsOptions = {},
): Promise<ReconcileOrphanedClaimsResult> {
  const idleMs = opts.idleMs ?? 12 * 60 * 60 * 1000;
  const limit = opts.limit ?? 200;
  const idleSecs = Math.floor(idleMs / 1000);

  const candidates = await db
    .select({
      id: workItems.id,
      status: workItems.status,
      updatedAt: workItems.updatedAt,
      sourceMetadata: workItems.sourceMetadata,
    })
    .from(workItems)
    .where(
      and(
        eq(workItems.status, "in_progress"),
        sql`coalesce(${workItems.updatedAt}, ${workItems.createdAt})
            < now() - make_interval(secs => ${idleSecs})`,
      ),
    )
    .limit(limit);

  const released: { id: string; reason: string }[] = [];

  for (const item of candidates) {
    const [sessions, runs] = await Promise.all([
      db
        .select({ n: sql<number>`count(*)::int` })
        .from(chatConversations)
        .where(
          and(
            eq(chatConversations.workItemId, item.id),
            inArray(chatConversations.status, ACTIVE_SESSION_STATUSES),
          ),
        ),
      db
        .select({
          total: sql<number>`count(*)::int`,
          live: sql<number>`count(*) filter (where ${agentRuns.status} not in ${TERMINAL_RUN_STATUSES})::int`,
        })
        .from(agentRuns)
        .where(eq(agentRuns.workItemId, item.id)),
    ]);

    const outcome = resolveOrphanedClaim({
      status: item.status,
      hasActiveSession: (sessions[0]?.n ?? 0) > 0,
      hasActiveRun: (runs[0]?.live ?? 0) > 0,
      hasAnyRun: (runs[0]?.total ?? 0) > 0,
      idleMs: Date.now() - new Date(item.updatedAt ?? Date.now()).getTime(),
      thresholdMs: idleMs,
    });

    if (!outcome.release) continue;
    released.push({ id: item.id, reason: outcome.reason });

    if (opts.dryRun) continue;
    try {
      // Carry the existing attempt count through: mirrorWorkItemEvent writes
      // whatever it is given, and resetting it would erase the history that
      // decides when an item is given up on as blocked.
      const attempts = Number(
        (item.sourceMetadata as Record<string, unknown> | null)?.attempts ?? 0,
      );
      await mirrorWorkItemEvent(db, item.id, {
        kind: "requeued",
        reason: outcome.reason,
        attempt: Number.isFinite(attempts) ? attempts : 0,
      });
    } catch (err) {
      console.error(
        `[orphan-reconcile] release of work item ${item.id} failed:`,
        err,
      );
    }
  }

  return {
    released: released.length,
    items: released,
    dryRun: Boolean(opts.dryRun),
  };
}
