// Orphan-reap decision logic, kept pure + side-effect-free so it can be unit
// tested without a database (relay.test.ts mocks the db chain, so the reaper's
// SQL WHERE is otherwise untestable).
//
// The reaper terminalizes agent_runs that claim an active status but have no
// session past a grace period. The key correctness point is that "running" and
// "queued" are NOT the same risk:
//
//   - running + no session  → it purported to be executing but isn't. Definitely
//     orphaned. Short grace.
//   - queued  + no session  → it never started. This is ambiguous: it may be a
//     genuine orphan (a dispatch that died before linking a session) OR a run
//     that is legitimately waiting for a concurrency slot. Failing the latter is
//     a false death, so queued gets a much longer grace before we give up on it.

/** Grace for a `running` run with no session — clearly stuck. */
export const REAP_ORPHAN_RUNNING_GRACE_MS = 60 * 60_000; // 1h

/**
 * Grace for a `queued` run with no session — might just be waiting for a slot.
 * Long enough that a legitimately concurrency-capped run gets its turn, short
 * enough that a truly abandoned queued row is still cleaned up eventually.
 */
export const REAP_ORPHAN_QUEUED_GRACE_MS = 12 * 60 * 60_000; // 12h

export type OrphanCandidate = {
  status: string;
  sessionId: string | null | undefined;
  createdAt: Date | string;
};

/** Per-status grace, or null if the status is never orphan-reapable. */
export function orphanReapGraceMs(status: string): number | null {
  if (status === "running") return REAP_ORPHAN_RUNNING_GRACE_MS;
  if (status === "queued") return REAP_ORPHAN_QUEUED_GRACE_MS;
  return null;
}

/**
 * True when a run should be reaped as an orphan: an active status with no
 * session, aged past that status's grace. Terminal/other statuses and runs that
 * still hold a session (the lease sweep's job) are never reaped here.
 */
export function isReapableOrphan(
  candidate: OrphanCandidate,
  now: Date = new Date(),
): boolean {
  if (candidate.sessionId) return false;
  const grace = orphanReapGraceMs(candidate.status);
  if (grace === null) return false;
  const created = new Date(candidate.createdAt).getTime();
  if (!Number.isFinite(created)) return false;
  return now.getTime() - created >= grace;
}

/** Cutoff timestamps (ISO) the bulk reap query compares createdAt against. */
export function orphanReapCutoffs(now: Date = new Date()): {
  runningCutoff: string;
  queuedCutoff: string;
} {
  return {
    runningCutoff: new Date(now.getTime() - REAP_ORPHAN_RUNNING_GRACE_MS).toISOString(),
    queuedCutoff: new Date(now.getTime() - REAP_ORPHAN_QUEUED_GRACE_MS).toISOString(),
  };
}
