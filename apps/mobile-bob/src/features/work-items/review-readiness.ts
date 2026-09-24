/**
 * Whether an item asking to be reviewed actually has anything to review.
 *
 * A run that terminates advances its work item to `in_review` whether or not
 * it attached anything. In the production workspace that produced 3,116 items
 * marked "Review ready" with zero artifacts and zero comments across 6,641
 * runs — a screen demanding action while showing nothing, which reads as a
 * broken app rather than an empty result.
 *
 * The board is the right place to fix the cause; this is so the screen stops
 * lying in the meantime, and stays honest whenever it happens again.
 */

/** Statuses that ask a person to look at the work. */
const AWAITING_REVIEW = new Set(["in_review", "review", "review_ready"]);

export interface ReviewReadinessInput {
  status: string;
  artifactCount: number;
  commentCount: number;
  childCount?: number;
}

export interface ReviewReadinessNotice {
  title: string;
  detail: string;
}

/**
 * Returns a notice only when the item claims to need review and has nothing
 * attached. Everything else renders as it always did.
 */
export function describeReviewReadiness(
  input: ReviewReadinessInput,
): ReviewReadinessNotice | null {
  if (!AWAITING_REVIEW.has(input.status)) return null;
  if (input.artifactCount > 0 || input.commentCount > 0) return null;
  if ((input.childCount ?? 0) > 0) return null;

  return {
    title: "Nothing to review yet",
    detail:
      "This item is marked ready for review, but the run finished without " +
      "attaching an artifact, comment or child item. There is nothing here " +
      "to act on — the run likely produced no output.",
  };
}
