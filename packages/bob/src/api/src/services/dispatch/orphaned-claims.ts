/**
 * Work items that claim to be in progress with nothing behind them.
 *
 * `reapStuckSessions` releases an item through its session, which covers a run
 * that started and died. It cannot see the other two shapes, because there is
 * no session to find:
 *
 *   - claimed but never dispatched — 275 production items had no run at all
 *   - run ended, item never moved — 167 more, all runs terminal
 *
 * Together those were 454 items reading "In Progress" while zero runs were
 * live anywhere in the workspace, the oldest untouched for a month. A status
 * nothing ever retracts is a claim, not a state.
 *
 * The decision is deliberately separated from the query so the policy can be
 * tested without a database, and so it stays conservative: an item is only
 * orphaned when nothing is running AND it has been quiet for a long time.
 */

export interface OrphanedClaimInput {
  status: string;
  /** A session in an active status still holds this item. */
  hasActiveSession: boolean;
  /** A run that has not reached a terminal status. */
  hasActiveRun: boolean;
  /** Whether any run was ever recorded against the item. */
  hasAnyRun: boolean;
  /** Milliseconds since the item was last touched. */
  idleMs: number;
  /** How long an item may sit untouched before it counts as abandoned. */
  thresholdMs: number;
}

export type OrphanedClaimOutcome =
  | { release: false }
  | { release: true; to: "todo"; reason: string };

export function resolveOrphanedClaim(
  input: OrphanedClaimInput,
): OrphanedClaimOutcome {
  if (input.status !== "in_progress") return { release: false };
  // Anything live is someone else's business: the session reaper owns those.
  if (input.hasActiveSession || input.hasActiveRun) return { release: false };
  if (input.idleMs < input.thresholdMs) return { release: false };

  return {
    release: true,
    to: "todo",
    reason: input.hasAnyRun
      ? "every run ended and the item was never reconciled"
      : "claimed but never dispatched — no run was ever recorded",
  };
}
