import type { ItemState, Milestone, ReleaseStage } from "./generated/contract";

export type Owner = "system" | "agent" | "human" | "terminal";
export type Attention = "ok" | "needs_human" | "stalled" | "failed";
export interface StatePresentation {
  label: string;
  owner: Owner;
  attention: Attention;
  col: number;
  row: number;
  hint: string;
}

export const STATE_PRESENTATION = {
  // validating, review and deploying are driven by the coordinator's release driver
  // (BOB-82): publish → CI → review-ready → merge → deploy → production-verified.
  pending:             { label: "Pending",           owner: "system",   attention: "ok",          col: 0, row: 0, hint: "dependencies unmet or plan not active" },
  ready:               { label: "Ready",             owner: "system",   attention: "ok",          col: 1, row: 0, hint: "waiting for capacity" },
  reserved:            { label: "Reserved",          owner: "system",   attention: "ok",          col: 2, row: 0, hint: "T3 admission" },
  running:             { label: "Running",           owner: "agent",    attention: "ok",          col: 3, row: 0, hint: "attempt in a T3 thread" },
  "waiting-input":     { label: "Waiting for input", owner: "human",    attention: "needs_human", col: 3, row: 1, hint: "an agent asked a question" },
  "execution-unknown": { label: "Execution unknown", owner: "system",   attention: "stalled",     col: 2, row: 1, hint: "admission unconfirmed; dispatch retries after the lease" },
  validating:          { label: "Validating",        owner: "system",   attention: "ok",          col: 4, row: 0, hint: "publishing the branch and running CI" },
  review:              { label: "Review",            owner: "human",    attention: "needs_human", col: 4, row: 2, hint: "PR ready: approve and merge" },
  deploying:           { label: "Deploying",         owner: "system",   attention: "ok",          col: 3, row: 2, hint: "merged; deploying to production" },
  completed:           { label: "Completed",         owner: "system",   attention: "ok",          col: 2, row: 2, hint: "completion target met" },
  failed:              { label: "Failed",            owner: "terminal", attention: "failed",      col: 0, row: 3, hint: "retry starts a new attempt" },
  cancelling:          { label: "Cancelling",        owner: "system",   attention: "ok",          col: 1, row: 3, hint: "" },
  cancelled:           { label: "Cancelled",         owner: "terminal", attention: "ok",          col: 2, row: 3, hint: "retry needs an active plan and a prior attempt" },
} as const satisfies Record<ItemState, StatePresentation>;

export interface StateEdge {
  from: ItemState;
  to: ItemState;
  /** A back edge (the item can return to an earlier state); drawn curved. */
  loop?: true;
}

/**
 * Only the item transitions the coordinator performs today, checked against
 * packages/bob/coordination/runtime. States the contract declares but nothing
 * writes yet (waiting-input, cancelling) have no edges.
 */
export const STATE_EDGES: ReadonlyArray<StateEdge> = [
  // coordinator.mjs writeItems: a plan start/resume makes dependency-free items ready;
  // execution.mjs readyDependents makes pending items ready once upstream milestones land.
  { from: "pending", to: "ready" },
  // coordinator.mjs writeItems: pausing an active plan rewrites attempt-less items to pending.
  { from: "ready", to: "pending", loop: true },
  // coordinator.mjs writeItems: cancelling a plan cancels items that have no attempt.
  { from: "pending", to: "cancelled" },
  { from: "ready", to: "cancelled" },
  // execution.mjs reserve (RequestExecution).
  { from: "ready", to: "reserved" },
  // execution.mjs dispatchOne: admission succeeds, or fails into execution-unknown, then is replayed.
  { from: "reserved", to: "running" },
  { from: "reserved", to: "execution-unknown" },
  { from: "execution-unknown", to: "running" },
  // execution.mjs receive (RecordExecutionReceipt): succeeded, unless the completion target is execution.
  { from: "running", to: "validating" },
  { from: "running", to: "completed" },
  { from: "running", to: "failed" },
  { from: "running", to: "cancelled" },
  // The release driver (BOB-82): CI green opens review; a merge starts the deploy
  // (or completes a merged-target item); production verification completes it.
  { from: "validating", to: "review" },
  { from: "review", to: "deploying" },
  { from: "review", to: "completed" },
  { from: "deploying", to: "completed" },
  // CI failed (release.stage checks-failed); Retry starts a new attempt.
  { from: "validating", to: "failed" },
  // The PR head moved: checks run again.
  { from: "review", to: "validating", loop: true },
  // execution.mjs RetryItem: an unversioned ready write, then reserve, so observers see a jump to reserved.
  { from: "failed", to: "reserved", loop: true },
  { from: "cancelled", to: "reserved", loop: true },
];

export interface ReleaseStagePresentation { label: string; attention: Attention; hint: string }

/** Every ReleaseStage (contract.forge, generated into RELEASE_STAGES). blocked always carries a note. */
export const RELEASE_STAGE_PRESENTATION = {
  "awaiting-publish":    { label: "Awaiting publish", attention: "ok",          hint: "the branch is not pushed yet" },
  "checks-running":      { label: "Checks running",   attention: "ok",          hint: "CI is running on the head" },
  "checks-failed":       { label: "Checks failed",    attention: "failed",      hint: "CI failed; retry starts a new attempt" },
  "review-ready":        { label: "Review ready",     attention: "needs_human", hint: "CI green; approve and merge" },
  merged:                { label: "Merged",           attention: "ok",          hint: "waiting for the production deploy" },
  deploying:             { label: "Deploying",        attention: "ok",          hint: "deploying to production" },
  "production-verified": { label: "Prod verified",    attention: "ok",          hint: "deployed and healthy in production" },
  blocked:               { label: "Blocked",          attention: "needs_human", hint: "the release needs attention" },
} as const satisfies Record<ReleaseStage, ReleaseStagePresentation>;

const HOUR = 3_600_000;
/**
 * How long the system may keep an item in a state before it reads as stalled (BOB-101).
 * Only states the system owns and should leave on its own: waiting for capacity (ready),
 * for a human (review, waiting-input) or for dependencies (pending) is not a stall.
 */
export const STALL_AFTER_MS: Partial<Record<ItemState, number>> = {
  reserved: HOUR,
  running: 24 * HOUR,
  validating: 6 * HOUR,
  deploying: 2 * HOUR,
  cancelling: HOUR,
};

/** How long the item has been in its current state, or null when the edge does not know. */
export const stateAge = (item: { stateSince?: number | null }, now: number): number | null =>
  typeof item.stateSince === "number" ? Math.max(0, now - item.stateSince) : null;

/**
 * An item's attention, refined by its release: a blocked release needs a human in any
 * state, and a review-ready release that will auto-merge does not. With `now`, an item
 * that would otherwise be ok but has sat past STALL_AFTER_MS in its state is stalled.
 */
export function itemAttention(
  item: { state: ItemState; release?: { stage: ReleaseStage; autoMerge: boolean } | null; stateSince?: number | null },
  now?: number,
): Attention {
  const attention = releaseAttention(item);
  if (attention !== "ok" || now === undefined) return attention;
  const limit = STALL_AFTER_MS[item.state];
  const age = stateAge(item, now);
  return limit !== undefined && age !== null && age > limit ? "stalled" : "ok";
}

function releaseAttention(item: { state: ItemState; release?: { stage: ReleaseStage; autoMerge: boolean } | null }): Attention {
  const base = STATE_PRESENTATION[item.state].attention;
  const release = item.release;
  if (!release) return base;
  if (release.stage === "blocked") return item.state === "failed" ? "failed" : "needs_human";
  if (release.stage === "checks-failed") return "failed";
  if (item.state === "review" && release.stage === "review-ready" && release.autoMerge) return "ok";
  return base;
}

export const MILESTONE_LABEL = {
  "execution-succeeded": "exec ✓",
  "review-ready": "review-ready",
  merged: "merged",
  "production-verified": "prod-verified",
} as const satisfies Record<Milestone, string>;
