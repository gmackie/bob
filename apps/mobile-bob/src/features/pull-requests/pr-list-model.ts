/**
 * The mobile pull-request list.
 *
 * This is the on-the-road surface. The question a person is answering with a
 * phone in one hand is "is anything waiting on ME?", not "show me every PR" —
 * so the list leads with work blocked on the reader and pushes merged and
 * closed work down, rather than sorting by date and making them hunt for it.
 */

export interface PrRow {
  id: string;
  number: number;
  title: string;
  status: string;
  /** Present when a review has been left; `changes_requested` blocks the author. */
  reviewState?: string | null;
  repositoryName?: string | null;
  updatedAt?: string | null;
}

export interface PrListItem extends PrRow {
  /** Precomputed so the row component does not re-derive triage rules. */
  needsYou: boolean;
}

/**
 * Group order. Lower sorts first.
 *
 * Blocked work leads because it is the only thing a person can genuinely move
 * from a phone. Drafts sit below open work: a draft is yours to finish, and it
 * should not compete with someone waiting on a review.
 */
function groupRank(row: PrRow): number {
  if (row.status === "open" && row.reviewState === "changes_requested") return 0;
  if (row.status === "open") return 1;
  if (row.status === "draft") return 2;
  return 3; // merged, closed, anything else
}

function updatedMillis(row: PrRow): number {
  if (!row.updatedAt) return 0;
  const parsed = Date.parse(row.updatedAt);
  // A row with an unreadable timestamp still matters; sorting it last beats
  // hiding a PR someone is waiting on.
  return Number.isFinite(parsed) ? parsed : 0;
}

export function buildPrList(rows: readonly PrRow[]): PrListItem[] {
  return [...rows]
    .sort((a, b) => groupRank(a) - groupRank(b) || updatedMillis(b) - updatedMillis(a))
    .map((row) => ({
      ...row,
      needsYou: row.status === "open" && row.reviewState === "changes_requested",
    }));
}

const TONES: Record<string, string> = {
  open: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
  draft: "bg-neutral-200 text-neutral-700 dark:bg-neutral-700 dark:text-neutral-300",
  merged: "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300",
  closed: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300",
};

/** A status this build does not know still needs to be legible, not invisible. */
export function prStatusTone(status: string): string {
  return TONES[status] ?? "bg-neutral-200 text-neutral-700 dark:bg-neutral-700 dark:text-neutral-300";
}
