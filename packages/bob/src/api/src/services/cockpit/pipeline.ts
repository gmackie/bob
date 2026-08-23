/**
 * Derive a PR's pipeline stage states from the facts the loop already has.
 * Pure so the (many) edge cases are unit-tested rather than discovered on a
 * wall at 3 m. Mirrors the merge gate in autoMergeReview: a PR merges when
 * bob-reviewer APPROVED at the head AND CI is green (with ≥1 check) AND it is
 * mergeable; failing CI / REQUEST_CHANGES / conflicts send it to repair, which
 * is capped per PR.
 */
import type { PipelineStageState, PrPipeline } from "./types.js";

export interface PipelineFacts {
  merged: boolean;
  mergedAt?: string | null;
  closed: boolean;
  mergeable: boolean | null;
  /** Combined CI state: success | failure | error | pending | none (provider strings pass through). */
  ciState: string;
  ciTotal: number;
  /** bob-reviewer verdict at the current head, if any. */
  verdict: "APPROVED" | "REQUEST_CHANGES" | "COMMENT" | null;
  reviewInFlight: boolean;
  repairAttempts: number;
  repairCap: number;
  repairInFlight: boolean;
  /** Deploy evidence outcome from the deploy tracker (post-merge). */
  deploy: "success" | "failure" | "pending" | "none" | null;
}

export function derivePipeline(f: PipelineFacts): { stages: PrPipeline["stages"]; parkedReason: string | null } {
  const s: PrPipeline["stages"] = {
    code: "done",
    ci: "waiting",
    review: "waiting",
    repair: "skipped",
    merge: "waiting",
    deploy: "waiting",
  };
  let parkedReason: string | null = null;

  // CI
  if (f.ciState === "success" && f.ciTotal > 0) s.ci = "done";
  else if (f.ciState === "failure" || f.ciState === "error") s.ci = "failed";
  else if (f.ciState === "pending" || (f.ciTotal === 0 && f.ciState !== "none")) s.ci = "active";
  else s.ci = f.ciTotal === 0 ? "waiting" : "active";

  // Review
  if (f.verdict === "APPROVED") s.review = "done";
  else if (f.verdict === "REQUEST_CHANGES") s.review = "failed";
  else if (f.reviewInFlight) s.review = "active";
  else s.review = "waiting";

  const needsRepair = s.ci === "failed" || s.review === "failed" || f.mergeable === false;

  // Repair
  if (f.repairInFlight) s.repair = "active";
  else if (needsRepair && f.repairAttempts >= f.repairCap) {
    s.repair = "failed";
    parkedReason = `repair cap ${f.repairCap} reached`;
  } else if (needsRepair) s.repair = f.repairAttempts > 0 ? "active" : "waiting";
  else if (f.repairAttempts > 0) s.repair = "done";
  else s.repair = "skipped";

  // Merge / deploy
  if (f.merged) {
    s.merge = "done";
    s.repair = f.repairAttempts > 0 ? "done" : "skipped";
    s.ci = s.ci === "waiting" ? "done" : s.ci;
    if (f.deploy === "success") s.deploy = "done";
    else if (f.deploy === "failure") s.deploy = "failed";
    else if (f.deploy === "pending") s.deploy = "active";
    else s.deploy = "skipped"; // no visible deploy mechanism → done = merged
  } else if (f.closed) {
    s.merge = "failed";
    parkedReason = parkedReason ?? "closed without merging";
  } else if (s.ci === "done" && s.review === "done" && f.mergeable !== false) {
    s.merge = "active"; // next auto-merge tick will take it
  } else if (parkedReason) {
    s.merge = "waiting";
  }

  if (!f.merged && !f.closed && f.ciTotal === 0 && f.ciState === "none" && s.review === "done") {
    parkedReason = parkedReason ?? "no CI checks on this repo — needs a human merge";
  }

  return { stages: s, parkedReason };
}

export function stageLabel(state: PipelineStageState): string {
  return { done: "✓", active: "◐", failed: "✗", waiting: "·", skipped: "–" }[state];
}
