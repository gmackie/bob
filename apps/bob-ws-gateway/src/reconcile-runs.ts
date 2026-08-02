// Count-reconciliation logic, kept pure + unit-testable (relay.test.ts mocks the
// db, so the sweep's SQL is otherwise untestable).
//
// The session (chat_conversations) is the source of truth for status, and
// applySessionStatus already terminalizes the linked agent_run when a session
// goes terminal. But that sync happens once, inline: a dropped write or a crash
// between the two commits can strand an agent_run in an active status while its
// session is already terminal — leaving "what's running" over-counted forever.
//
// This is a safe backstop. It ONLY moves an active run to the terminal status
// its ALREADY-terminal session implies. It can never touch a live run (a live
// run's session is not terminal) and only ever moves active → terminal, never
// the reverse — so it can't stomp or resurrect anything.

/** agent_run statuses that are still active (reconcilable). */
export const ACTIVE_AGENT_RUN_STATUSES = [
  "queued",
  "running",
  "blocked",
  "host_unknown",
] as const;

/** chat_conversations statuses that are terminal (a finished session). */
export const TERMINAL_SESSION_STATUSES = [
  "completed",
  "failed",
  "error",
  "interrupted",
  "stopped",
] as const;

export type ReconciledRunStatus = "completed" | "failed" | "interrupted";

/**
 * The agent_run terminal status implied by a terminal session status. Returns
 * null when the session status is NOT terminal — the caller must then leave the
 * run untouched (it may still be legitimately active).
 */
export function reconciledRunStatus(sessionStatus: string): ReconciledRunStatus | null {
  switch (sessionStatus) {
    case "completed":
      return "completed";
    case "failed":
    case "error":
      return "failed";
    case "interrupted":
    case "stopped":
      return "interrupted";
    default:
      return null;
  }
}

/** Whether an agent_run in this status is a candidate for reconciliation. */
export function isActiveAgentRunStatus(status: string): boolean {
  return (ACTIVE_AGENT_RUN_STATUSES as readonly string[]).includes(status);
}

/**
 * Decide the reconciliation for one (run, session) pair. Returns the terminal
 * status to set, or null to leave the run alone. Safe by construction: only
 * active runs whose session is terminal are ever reconciled.
 */
export function reconcileRunAgainstSession(
  runStatus: string,
  sessionStatus: string,
): ReconciledRunStatus | null {
  if (!isActiveAgentRunStatus(runStatus)) return null;
  return reconciledRunStatus(sessionStatus);
}
