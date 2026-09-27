/**
 * Recurring upstream issues that should not become a new work item each time.
 *
 * `findOrCreateWorkItem` dedupes on `externalId` alone. That is correct for the
 * same issue being updated, and useless against the pattern that actually
 * filled the board: a scheduled job upstream mints a **new** issue every week
 * with the same title, so the external id never matches and Bob creates
 * another copy while the previous ones are still open.
 *
 * Production, 2026-09-24: 4,539 work items, 4,020 distinct titles. 445
 * duplicate (workspace, title) groups covering 964 items, and 226 of those
 * groups had two or more copies open **at the same time**, covering 520 items.
 * Zero duplicate groups shared an external id, which is why a unique
 * constraint on (provider, externalId) would have changed nothing. One example,
 * created once a week and never finished:
 *
 *     Fix critical errors for bob   Jul 21, Aug 1, Aug 9, Aug 21, Aug 23,
 *                                   Aug 30, Sep 6, Sep 13, Sep 20
 *
 * Eight of those nine were still `backlog`.
 *
 * So the rule is scoped to what is open. A title recurring after the previous
 * one was finished is legitimate work happening again, and it gets its own
 * item. A title recurring while a copy is still open is the same ask arriving
 * twice, and it folds into the open item with its lineage recorded, so nothing
 * about the new upstream issue is lost.
 *
 * The decision is a pure function over plain values so the policy is testable
 * without a database, and so the normalisation has exactly one implementation.
 */

/** Statuses that mean the work is over and a recurrence is genuinely new. */
export const CLOSED_STATUSES: ReadonlySet<string> = new Set([
  "done",
  "cancelled",
  "canceled",
  "failed",
]);

export interface CandidateWorkItem {
  id: string;
  title: string;
  status: string;
}

export interface IncomingIssue {
  title: string;
  provider: string;
  externalId: string;
  externalUrl?: string | null;
}

/** What is appended to the surviving item so the new issue is traceable. */
export interface RecurrenceRecord {
  provider: string;
  id: string;
  url: string | null;
  seenAt: string;
}

export type RecurrenceOutcome =
  | { create: true }
  | { create: false; reuseWorkItemId: string; recurrence: RecurrenceRecord };

/**
 * Compare titles the way a person would: ignoring case, leading and trailing
 * space, and runs of whitespace.
 *
 * Deliberately conservative. Failing to merge two items is a duplicate on the
 * board, which is visible and cheap to fix. Wrongly merging two items loses a
 * real request, so anything cleverer than whitespace and case would need
 * evidence that it never merges distinct work.
 */
export function normalizeTitle(title: string): string {
  return title.trim().replace(/\s+/g, " ").toLowerCase();
}

export function resolveRecurrence(input: {
  incoming: IncomingIssue;
  /** Items in the same workspace and project. Status is re-checked here. */
  candidates: CandidateWorkItem[];
  now?: Date;
}): RecurrenceOutcome {
  const wanted = normalizeTitle(input.incoming.title);
  // An empty title carries no identity, so it must never merge anything.
  if (!wanted) return { create: true };

  const open = input.candidates.find(
    (candidate) =>
      !CLOSED_STATUSES.has(candidate.status) &&
      normalizeTitle(candidate.title) === wanted,
  );
  if (!open) return { create: true };

  return {
    create: false,
    reuseWorkItemId: open.id,
    recurrence: {
      provider: input.incoming.provider,
      id: input.incoming.externalId,
      url: input.incoming.externalUrl ?? null,
      seenAt: (input.now ?? new Date()).toISOString(),
    },
  };
}

/**
 * Append a recurrence to an item's existing metadata without dropping keys.
 *
 * Kept separate from `resolveRecurrence` so the merge is testable on its own:
 * `sourceMetadata` is `not null` in the schema and carries unrelated keys that
 * other code depends on, including the `attempts` count the dispatcher reads.
 */
export function appendRecurrence(
  existing: unknown,
  recurrence: RecurrenceRecord,
): Record<string, unknown> {
  const base =
    existing && typeof existing === "object" && !Array.isArray(existing)
      ? { ...(existing as Record<string, unknown>) }
      : {};
  const prior: unknown[] = Array.isArray(base.recurrences)
    ? (base.recurrences as unknown[])
    : [];
  return { ...base, recurrences: [...prior, recurrence] };
}
