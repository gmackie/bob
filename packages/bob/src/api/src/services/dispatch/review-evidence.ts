/**
 * Whether a finished run earned its work item a review.
 *
 * A completing run used to advance its item to `in_review` no matter what it
 * produced. In production that made 3,116 items ask for a review that could
 * not be performed: every one had a run, none had an artifact or a comment.
 * Of 3,171 completed runs only 120 attached anything, so the signal being
 * acted on was "the process exited", not "there is work to look at".
 *
 * "Review ready" has to mean a person can do something. Without evidence the
 * item stays where it is; the stale-claim reaper is what moves it on, so this
 * decision stays narrow and testable.
 */

export interface ReviewEvidence {
  artifactCount: number;
  commentCount: number;
  /** A pull request is reviewable on its own, even with nothing attached here. */
  hasPullRequest?: boolean;
}

export type CompletionOutcome =
  | { advance: true; status: "in_review" }
  | { advance: false; reason: string };

export function resolveCompletionOutcome(
  evidence: ReviewEvidence,
): CompletionOutcome {
  if (evidence.hasPullRequest) return { advance: true, status: "in_review" };
  if (evidence.artifactCount > 0) return { advance: true, status: "in_review" };
  if (evidence.commentCount > 0) return { advance: true, status: "in_review" };

  return {
    advance: false,
    reason:
      "run completed without attaching an artifact, comment or pull request",
  };
}
