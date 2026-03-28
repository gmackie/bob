/**
 * Maps between Bob's kanban statuses and ForgeGraph's delivery statuses.
 *
 * Bob uses:     draft, backlog, todo, planned, in_progress, in_review, done, cancelled
 * ForgeGraph:   draft, ready_for_review, changes_requested, approved,
 *               ready_for_staging, staging_failed, staging_verified,
 *               ready_for_release, released
 */

const bobToFg: Record<string, string> = {
  draft: "draft",
  backlog: "draft",
  todo: "draft",
  planned: "draft",
  in_progress: "approved",
  in_review: "ready_for_review",
  done: "released",
  cancelled: "released",
};

const fgToBob: Record<string, string> = {
  draft: "backlog",
  ready_for_review: "in_review",
  changes_requested: "in_progress",
  approved: "in_progress",
  ready_for_staging: "in_progress",
  staging_failed: "in_progress",
  staging_verified: "in_progress",
  ready_for_release: "in_progress",
  released: "done",
};

/** Convert a Bob status to a ForgeGraph status for API writes. */
export function toFgStatus(bobStatus: string): string {
  return bobToFg[bobStatus] ?? "draft";
}

/** Convert a ForgeGraph status to a Bob status for UI display. */
export function toBobStatus(fgStatus: string): string {
  return fgToBob[fgStatus] ?? "backlog";
}
