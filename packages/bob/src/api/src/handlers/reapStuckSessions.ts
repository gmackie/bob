// Zombie-session reaper.
//
// autoDrain counts a session as "holding a runner slot" while its status is in
// ACTIVE_SESSION_STATUSES (pending/provisioning/starting/running/blocked/
// stopping/host_unknown). The ws-gateway's lease sweep moves a session whose
// heartbeat lapsed to `host_unknown` — but NOTHING then terminates it, so a
// session whose runner died sits in an active status forever and permanently
// consumes a concurrency slot. Enough of them (`running=17-20, no free slots`)
// starves autoDrain and the whole autonomous pipeline stalls.
//
// This reaper marks provably-dead sessions terminal so their slot frees. It is
// deliberately conservative — it only touches sessions that are BOTH in an
// active status AND past a generous timeout, so a live, recently-heartbeating
// session is never killed:
//   - lease-expired: `leaseExpiresAt` is in the past by more than `leaseGraceMs`
//     (a live runner renews its lease every heartbeat, so an old expiry means
//     the runner is gone); OR
//   - never-leased + inactive: no lease was ever claimed and there has been no
//     activity for longer than `hardTimeoutMs` (covers sessions wedged in
//     pending/provisioning because dispatch died before a gateway claimed them).
//
// `blocked` is intentionally NOT reaped here: it means the run is paused on a
// human decision, governed by `awaitingInputExpiresAt` (see awaitingInputExpiry
// service), not a runner timeout — killing it on a clock would discard a
// legitimately-waiting session.

import { and, eq, inArray, or, sql } from "@bob/db";
import { db } from "@bob/db/client";
import { chatConversations, workItems } from "@bob/db/schema";
import { mirrorWorkItemEvent } from "../services/tracker/trackerMirror.js";

// Active statuses that hold an autoDrain slot, EXCEPT `blocked` (see header).
const REAPABLE_ACTIVE_STATUSES = [
  "pending",
  "provisioning",
  "starting",
  "running",
  "stopping",
  "host_unknown",
];

export interface ReapStuckSessionsOptions {
  /**
   * How long a lease must have been expired before the session is considered
   * dead. A live runner renews its lease every heartbeat (default grace 60s),
   * so 30 min of expiry is unambiguous. Default 30 min.
   */
  leaseGraceMs?: number;
  /**
   * For sessions that never had a lease claimed, how long with no activity
   * (lastActivityAt / updatedAt / createdAt) before they're reaped. Longer than
   * the lease grace because there's no heartbeat to lean on. Default 2 h.
   */
  hardTimeoutMs?: number;
  /** Re-queue a released work item this many times before blocking it. */
  maxAttempts?: number;
  /** Don't write; just report what would be reaped. */
  dryRun?: boolean;
}

export interface ReapStuckSessionsResult {
  reaped: number;
  sessions: { id: string; status: string; agentType: string | null }[];
  dryRun: boolean;
}

export async function reapStuckSessions(
  opts: ReapStuckSessionsOptions = {},
): Promise<ReapStuckSessionsResult> {
  const leaseGraceMs = opts.leaseGraceMs ?? 30 * 60 * 1000;
  const hardTimeoutMs = opts.hardTimeoutMs ?? 2 * 60 * 60 * 1000;
  const leaseGraceSecs = Math.floor(leaseGraceMs / 1000);
  const hardTimeoutSecs = Math.floor(hardTimeoutMs / 1000);

  // A session is dead if it's in an active-but-reapable status AND either its
  // lease expired long ago, or it was never leased and has gone quiet.
  const deadPredicate = and(
    inArray(chatConversations.status, REAPABLE_ACTIVE_STATUSES),
    or(
      sql`${chatConversations.leaseExpiresAt} is not null
        and ${chatConversations.leaseExpiresAt} < now() - make_interval(secs => ${leaseGraceSecs})`,
      sql`${chatConversations.leaseExpiresAt} is null
        and coalesce(${chatConversations.lastActivityAt}, ${chatConversations.updatedAt}, ${chatConversations.createdAt}::timestamptz)
            < now() - make_interval(secs => ${hardTimeoutSecs})`,
    ),
  );

  if (opts.dryRun) {
    const rows = await db
      .select({
        id: chatConversations.id,
        status: chatConversations.status,
        agentType: chatConversations.agentType,
      })
      .from(chatConversations)
      .where(deadPredicate);
    return { reaped: rows.length, sessions: rows, dryRun: true };
  }

  const reaped = await db
    .update(chatConversations)
    .set({
      status: "failed",
      claimedByGatewayId: null,
      leaseExpiresAt: null,
      lastError: {
        code: "reaped_stuck_session",
        message:
          "Reaped by the stuck-session sweep: active status with an expired lease / no activity past the timeout (runner presumed dead).",
        timestamp: new Date().toISOString(),
      },
      updatedAt: new Date().toISOString(),
    })
    .where(deadPredicate)
    .returning({
      id: chatConversations.id,
      status: chatConversations.status,
      agentType: chatConversations.agentType,
      workItemId: chatConversations.workItemId,
    });

  // Release the work item the dead session was holding. Before this, a reaped
  // session left its item in in_progress forever (auto-drain only re-picks
  // ready/todo), so every runner death permanently leaked a card — 29 such
  // orphans by 2026-08-20. Re-queue up to MAX_ATTEMPTS, then block for a human.
  const maxAttempts = opts.maxAttempts ?? 3;
  for (const s of reaped) {
    if (!s.workItemId) continue;
    try {
      const item = await db.query.workItems.findFirst({
        where: eq(workItems.id, s.workItemId),
        columns: { status: true, sourceMetadata: true },
      });
      if (!item || item.status !== "in_progress") continue;
      const prior = Number((item.sourceMetadata as Record<string, unknown>)?.attempts ?? 0);
      const attempt = prior + 1;
      const reason = `session ${s.id.slice(0, 8)} (${s.agentType ?? "?"}) reaped as stuck`;
      await mirrorWorkItemEvent(
        db,
        s.workItemId,
        attempt >= maxAttempts
          ? { kind: "blocked", reason: `${attempt} runs died without finishing; last: ${reason}` }
          : { kind: "requeued", reason, attempt },
      );
    } catch (err) {
      console.error(`[session-reap] release of work item ${s.workItemId} failed:`, err);
    }
  }

  return {
    reaped: reaped.length,
    sessions: reaped.map(({ id, status, agentType }) => ({ id, status, agentType })),
    dryRun: false,
  };
}
