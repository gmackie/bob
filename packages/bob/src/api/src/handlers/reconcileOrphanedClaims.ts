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

import { asc, exists, not, notInArray } from "drizzle-orm";
import { and, eq, inArray, sql } from "@bob/db";
import { db as defaultDb } from "@bob/db/client";
import { agentRuns, chatConversations, workItems } from "@bob/db/schema";
import { resolveOrphanedClaim } from "../services/dispatch/orphaned-claims.js";
import { mirrorAppliedWorkItemEvent } from "../services/tracker/trackerMirror.js";

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
const TERMINAL_RUN_STATUSES = ["completed", "failed", "interrupted"] satisfies
  (typeof agentRuns.$inferSelect)["status"][];

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
  db = defaultDb,
): Promise<ReconcileOrphanedClaimsResult> {
  const idleMs = opts.idleMs ?? 12 * 60 * 60 * 1000;
  const limit = opts.limit ?? 200;
  const idleSecs = Math.floor(idleMs / 1000);

  const lastTouched = sql<string>`coalesce(${workItems.updatedAt}, ${workItems.createdAt})`;
  const oldClaim = and(
    eq(workItems.status, "in_progress"),
    sql`${lastTouched} < now() - make_interval(secs => ${idleSecs})`,
  );
  const itemRuns = eq(agentRuns.workItemId, sql`${workItems.id}::text`);
  const hasAnyRun = exists(
    db.select({ id: agentRuns.id }).from(agentRuns).where(itemRuns),
  );
  const hasActiveRun = exists(
    db.select({ id: agentRuns.id }).from(agentRuns)
      .where(and(itemRuns, notInArray(agentRuns.status, TERMINAL_RUN_STATUSES))),
  );
  const hasActiveSession = exists(
    db.select({ id: chatConversations.id }).from(chatConversations)
      .where(and(
        eq(chatConversations.workItemId, workItems.id),
        inArray(chatConversations.status, ACTIVE_SESSION_STATUSES),
      )),
  );
  const hasLiveWork = sql`(${hasActiveSession} or ${hasActiveRun})`;
  const candidates = await db
    .select({
      id: workItems.id,
      status: workItems.status,
      lastTouched,
      hasActiveRun: sql<boolean>`${hasActiveRun}`,
      hasActiveSession: sql<boolean>`${hasActiveSession}`,
      hasAnyRun: sql<boolean>`${hasAnyRun}`,
    })
    .from(workItems)
    .where(oldClaim)
    .orderBy(asc(hasLiveWork), asc(lastTouched), asc(workItems.id))
    .limit(limit);

  const released: { id: string; reason: string }[] = [];

  for (const item of candidates) {
    const outcome = resolveOrphanedClaim({
      status: item.status,
      hasActiveSession: item.hasActiveSession,
      hasActiveRun: item.hasActiveRun,
      hasAnyRun: item.hasAnyRun,
      idleMs: Date.now() - new Date(item.lastTouched).getTime(),
      thresholdMs: idleMs,
    });

    if (!outcome.release) continue;

    if (opts.dryRun) {
      released.push({ id: item.id, reason: outcome.reason });
      continue;
    }
    try {
      // An overlapping tick or a newly active run may have changed this claim.
      const [changed] = await db
        .update(workItems)
        .set({ status: outcome.to })
        .where(and(eq(workItems.id, item.id), oldClaim, not(hasLiveWork)))
        .returning({
          id: workItems.id,
          status: workItems.status,
          sourceMetadata: workItems.sourceMetadata,
          externalProvider: workItems.externalProvider,
          externalId: workItems.externalId,
          workspaceId: workItems.workspaceId,
        });
      if (!changed) continue;
      const attempts = Number(changed.sourceMetadata.attempts ?? 0);
      released.push({ id: changed.id, reason: outcome.reason });
      await mirrorAppliedWorkItemEvent(
        db,
        changed,
        { kind: "requeued", reason: outcome.reason, attempt: Number.isFinite(attempts) ? attempts : 0 },
        outcome.to,
      );
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
