// Sessions actively holding a runner execution slot. Mirrors the runner's own
// busy check (its activeSessions map) — NOT "idle", which means the agent
// finished its turn and isn't consuming compute (and old idle sessions linger).
// Shared by autoDrain's concurrency check and the budget governor's
// runs-in-flight count (BOB-76) so the two can never disagree.
export const ACTIVE_SESSION_STATUSES = [
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
