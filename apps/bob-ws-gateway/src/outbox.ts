// Transactional notification outbox — the push path's durability layer.
//
// enqueueTransition() records the *send intent* exactly once per
// (sessionId, transition, sourceSendSeq): the unique index makes a
// redelivered envelope frame a no-op. The worker then claims rows and
// delivers via Expo. The ambiguous-send case is ACCEPTED, not denied: a
// crash between Expo accepting the request and the outcome commit leaves the
// row "claimed"; the reclaim sweep retries it, and because the messageId is
// stable across retries the client can dedup — a rare visible duplicate push
// is tolerated by design (delivery over APNs/FCM is at-least-once, full stop).
//
// The receipts cron closes the delivery loop: Expo receipts surface
// downstream APNs/FCM failures ~15 minutes after a send that looked fine at
// send time; DeviceNotRegistered receipts prune dead tokens so they stop
// eating tickets.

import { and, asc, eq, inArray, isNull, isNotNull, lt, sql } from "@bob/db";
import { db } from "@bob/db/client";
import { notificationOutbox, sessionEvents, chatConversations } from "@bob/db/schema";

import { pushToUser, pruneTokens } from "./push.js";

const EXPO_RECEIPTS_URL = "https://exp.host/--/api/v2/push/getReceipts";
const MAX_ATTEMPTS = 5;
const RECLAIM_AFTER_MS = 60_000;
const RECEIPTS_AFTER_MS = 15 * 60_000;
// Bound the per-tick claim so a backlog (DB-outage recovery, mass lease expiry)
// can't load an unbounded set into memory or run past the reclaim window and
// have its own rows re-claimed mid-flight by a second instance. The backlog
// drains across ticks.
const CLAIM_BATCH = 50;
// A sent row whose Expo receipts never resolve (permanent 4xx) must not occupy
// the receipts window forever — release it after this age.
const RECEIPTS_GIVE_UP_MS = 24 * 60 * 60_000;
// Event retention (prune output chunks of terminal runs). Bounded per tick.
const RETENTION_BATCH = 5_000;
const RETENTION_TERMINAL_STATUSES = [
  "completed",
  "failed",
  "error",
  "interrupted",
  "stopped",
] as const;

export interface TransitionNotification {
  sessionId: string;
  userId: string;
  /** blocked | failed | interrupted | completed | host_unknown */
  transition: string;
  /** Runner send-seq of the causing event; -1 for gateway-originated. */
  sourceSendSeq: number;
  title: string;
  body: string;
  data?: Record<string, unknown>;
  channelId?: string;
  priority?: "high" | "default";
  /**
   * Re-arm a prior, already-resolved occurrence on conflict instead of
   * dropping the insert. Gateway-originated transitions all key on
   * sourceSendSeq -1, so without this a second host_unknown for the same
   * session (lost -> recovered -> lost again) would be silently suppressed —
   * a missed trust-break notification. Only re-arms a row that already
   * delivered/failed or has been seen; a still-pending alarm is left alone.
   */
  reArmOnConflict?: boolean;
}

/**
 * Record the send intent. Exactly-once per occurrence — a duplicate
 * (sessionId, transition, sourceSendSeq) is dropped by the unique index, which
 * is precisely what a redelivered envelope frame should do. Set reArmOnConflict
 * for gateway-originated transitions whose -1 key would otherwise suppress
 * every later occurrence for the session's lifetime.
 */
export async function enqueueTransition(n: TransitionNotification): Promise<void> {
  const payload = {
    title: n.title,
    body: n.body,
    data: n.data ?? {},
    channelId: n.channelId ?? "tasks",
    priority: n.priority ?? "high",
  };
  const insert = db.insert(notificationOutbox).values({
    sessionId: n.sessionId,
    userId: n.userId,
    transition: n.transition,
    sourceSendSeq: n.sourceSendSeq,
    payload,
  });
  const stmt = n.reArmOnConflict
    ? insert.onConflictDoUpdate({
        target: [
          notificationOutbox.sessionId,
          notificationOutbox.transition,
          notificationOutbox.sourceSendSeq,
        ],
        set: {
          status: "pending",
          attempts: 0,
          claimedAt: null,
          sentAt: null,
          lastError: null,
          seenAt: null,
          expoTickets: null,
          receiptsResolvedAt: null,
          messageId: sql`gen_random_uuid()`,
          payload,
          createdAt: sql`now()`,
        },
        // Only re-arm a genuinely finished-and-seen prior alarm (a new
        // occurrence); a still-pending/unseen alarm is left untouched so one
        // outage never stacks duplicate pushes.
        setWhere: sql`(${notificationOutbox.status} in ('sent','failed') or ${notificationOutbox.seenAt} is not null)`,
      })
    : insert.onConflictDoNothing();
  await stmt.catch((err) => {
    // The intent row is load-bearing (badge + delivery); log loudly.
    console.error(`[outbox] enqueue failed for ${n.sessionId}/${n.transition}:`, err);
  });
}

export class OutboxWorker {
  private timer: NodeJS.Timeout | null = null;
  private receiptsTimer: NodeJS.Timeout | null = null;
  private retentionTimer: NodeJS.Timeout | null = null;
  private ticking = false;

  start(intervalMs = 2_000, receiptsIntervalMs = 60_000, retentionIntervalMs = 60 * 60_000): void {
    this.timer = setInterval(() => {
      void this.tick().catch((err) => console.error("[outbox] tick failed:", err));
    }, intervalMs);
    this.receiptsTimer = setInterval(() => {
      void this.receiptsTick().catch((err) =>
        console.error("[outbox] receipts tick failed:", err),
      );
    }, receiptsIntervalMs);
    this.retentionTimer = setInterval(() => {
      void this.retentionTick().catch((err) =>
        console.error("[outbox] retention tick failed:", err),
      );
    }, retentionIntervalMs);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    if (this.receiptsTimer) clearInterval(this.receiptsTimer);
    if (this.retentionTimer) clearInterval(this.retentionTimer);
    this.timer = null;
    this.receiptsTimer = null;
    this.retentionTimer = null;
  }

  /**
   * Prune output-chunk events of TERMINAL runs older than the configured
   * retention window (gateway_config.eventRetentionDays, default 30). Lifecycle
   * events (permission_request/_resolved, status_change, state, error,
   * gap_marker) are kept forever — they are the trust audit trail. Bounded per
   * tick so a large backlog drains gradually rather than locking the table.
   */
  async retentionTick(): Promise<void> {
    const cfg = await db.query.gatewayConfig.findFirst().catch(() => null);
    const days = cfg?.eventRetentionDays ?? 30;
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60_000).toISOString();
    const victims = await db
      .select({ id: sessionEvents.id })
      .from(sessionEvents)
      .innerJoin(chatConversations, eq(chatConversations.id, sessionEvents.sessionId))
      .where(
        and(
          inArray(chatConversations.status, [...RETENTION_TERMINAL_STATUSES]),
          eq(sessionEvents.eventType, "output_chunk"),
          lt(sessionEvents.createdAt, cutoff),
        ),
      )
      .limit(RETENTION_BATCH);
    if (victims.length === 0) return;
    await db.delete(sessionEvents).where(inArray(sessionEvents.id, victims.map((v) => v.id)));
    console.log(`[outbox] retention: pruned ${victims.length} output-chunk event(s) older than ${days}d`);
  }

  /** Claim and deliver pending rows; reclaim stuck "claimed" rows. */
  async tick(): Promise<void> {
    if (this.ticking) return;
    this.ticking = true;
    try {
      // Reclaim: rows stuck in "claimed" past the window are the ambiguous
      // ambiguous-send case — retry them (documented duplicate tolerance).
      const reclaimCutoff = new Date(Date.now() - RECLAIM_AFTER_MS).toISOString();
      await db
        .update(notificationOutbox)
        .set({ status: "pending" })
        .where(
          and(
            eq(notificationOutbox.status, "claimed"),
            lt(notificationOutbox.claimedAt, reclaimCutoff),
          ),
        );

      // Claim a BOUNDED batch. FOR UPDATE SKIP LOCKED lets a second gateway
      // instance claim a disjoint set without blocking or double-claiming.
      const claimTargets = db
        .select({ id: notificationOutbox.id })
        .from(notificationOutbox)
        .where(eq(notificationOutbox.status, "pending"))
        .orderBy(asc(notificationOutbox.createdAt))
        .limit(CLAIM_BATCH)
        .for("update", { skipLocked: true });
      const claimed = await db
        .update(notificationOutbox)
        .set({
          status: "claimed",
          claimedAt: sql`now()`,
          attempts: sql`${notificationOutbox.attempts} + 1`,
        })
        .where(inArray(notificationOutbox.id, claimTargets))
        .returning();

      for (const row of claimed) {
        const payload = (row.payload ?? {}) as {
          title?: string;
          body?: string;
          data?: Record<string, unknown>;
          channelId?: string;
          priority?: "high" | "default";
        };
        try {
          const result = await pushToUser(row.userId, {
            title: payload.title ?? "Bob",
            body: payload.body ?? "",
            // messageId is stable across retries — the client's dedup key.
            data: { ...(payload.data ?? {}), messageId: row.messageId },
            channelId: payload.channelId,
            priority: payload.priority,
          });
          await db
            .update(notificationOutbox)
            .set({
              status: "sent",
              sentAt: sql`now()`,
              ...(Object.keys(result.tickets).length > 0
                ? { expoTickets: result.tickets }
                : { receiptsResolvedAt: sql`now()` }),
            })
            .where(eq(notificationOutbox.id, row.id));
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          const exhausted = row.attempts >= MAX_ATTEMPTS;
          await db
            .update(notificationOutbox)
            .set({
              status: exhausted ? "failed" : "pending",
              lastError: message.slice(0, 500),
            })
            .where(eq(notificationOutbox.id, row.id));
          if (exhausted) {
            console.error(
              `[outbox] giving up on ${row.sessionId}/${row.transition} after ${row.attempts} attempts: ${message}`,
            );
          }
        }
      }
    } finally {
      this.ticking = false;
    }
  }

  /**
   * Resolve Expo receipts for sends older than the receipt window; prune
   * tokens whose receipts report DeviceNotRegistered. Send-time pruning
   * misses downstream APNs/FCM failures — this closes that loop.
   */
  async receiptsTick(): Promise<void> {
    // Release rows whose receipts can never resolve (permanent Expo 4xx) so a
    // stuck batch does not occupy the window forever, starving newer receipts.
    const giveUpCutoff = new Date(Date.now() - RECEIPTS_GIVE_UP_MS).toISOString();
    await db
      .update(notificationOutbox)
      .set({ receiptsResolvedAt: sql`now()`, lastError: "receipts unresolved past give-up window" })
      .where(
        and(
          eq(notificationOutbox.status, "sent"),
          isNull(notificationOutbox.receiptsResolvedAt),
          lt(notificationOutbox.sentAt, giveUpCutoff),
        ),
      );

    const cutoff = new Date(Date.now() - RECEIPTS_AFTER_MS).toISOString();
    const rows = await db.query.notificationOutbox.findMany({
      where: and(
        eq(notificationOutbox.status, "sent"),
        isNull(notificationOutbox.receiptsResolvedAt),
        isNotNull(notificationOutbox.expoTickets),
        lt(notificationOutbox.sentAt, cutoff),
      ),
      // Oldest first so a churning tail of new sends can't perpetually jump
      // ahead of rows waiting to resolve.
      orderBy: asc(notificationOutbox.sentAt),
      limit: 100,
    });
    if (rows.length === 0) return;

    for (const row of rows) {
      const tickets = (row.expoTickets ?? {}) as Record<string, string>;
      const ids = Object.values(tickets);
      if (ids.length === 0) {
        await db
          .update(notificationOutbox)
          .set({ receiptsResolvedAt: sql`now()` })
          .where(eq(notificationOutbox.id, row.id));
        continue;
      }
      try {
        const res = await fetch(EXPO_RECEIPTS_URL, {
          method: "POST",
          headers: { Accept: "application/json", "Content-Type": "application/json" },
          body: JSON.stringify({ ids }),
        });
        if (!res.ok) continue; // retry next cycle
        const receipts =
          ((await res.json()) as {
            data?: Record<string, { status: string; details?: { error?: string } }>;
          }).data ?? {};

        const deadTokens: string[] = [];
        for (const [token, ticketId] of Object.entries(tickets)) {
          const receipt = receipts[ticketId];
          if (receipt?.status === "error" && receipt.details?.error === "DeviceNotRegistered") {
            deadTokens.push(token);
          }
        }
        await pruneTokens(deadTokens);
        await db
          .update(notificationOutbox)
          .set({ receiptsResolvedAt: sql`now()` })
          .where(eq(notificationOutbox.id, row.id));
      } catch (err) {
        console.error("[outbox] receipt check failed (will retry):", err);
      }
    }
  }
}
