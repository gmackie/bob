import type { ItemState, Milestone } from "./generated/contract";

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
  // validating is "stalled" because nothing moves an item out of it yet: only
  // execution.mjs receive() writes it, and no validation receipt is implemented.
  // Flip it back to "ok" when RecordValidationReceipt lands in the coordinator.
  pending:             { label: "Pending",           owner: "system",   attention: "ok",          col: 0, row: 0, hint: "dependencies unmet or plan not active" },
  ready:               { label: "Ready",             owner: "system",   attention: "ok",          col: 1, row: 0, hint: "waiting for capacity" },
  reserved:            { label: "Reserved",          owner: "system",   attention: "ok",          col: 2, row: 0, hint: "T3 admission" },
  running:             { label: "Running",           owner: "agent",    attention: "ok",          col: 3, row: 0, hint: "attempt in a T3 thread" },
  "waiting-input":     { label: "Waiting for input", owner: "human",    attention: "needs_human", col: 3, row: 1, hint: "an agent asked a question" },
  "execution-unknown": { label: "Execution unknown", owner: "system",   attention: "stalled",     col: 2, row: 1, hint: "admission unconfirmed; dispatch retries after the lease" },
  validating:          { label: "Validating",        owner: "system",   attention: "stalled",     col: 4, row: 0, hint: "validation not yet automated" },
  review:              { label: "Review",            owner: "human",    attention: "needs_human", col: 4, row: 2, hint: "PR, approve, merge" },
  deploying:           { label: "Deploying",         owner: "system",   attention: "ok",          col: 3, row: 2, hint: "deploy and promote" },
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
 * writes yet (waiting-input, review, deploying, cancelling) have no edges.
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
  // execution.mjs RetryItem: an unversioned ready write, then reserve, so observers see a jump to reserved.
  { from: "failed", to: "reserved", loop: true },
  { from: "cancelled", to: "reserved", loop: true },
];

export const MILESTONE_LABEL = {
  "execution-succeeded": "exec ✓",
  "review-ready": "review-ready",
  merged: "merged",
  "production-verified": "prod-verified",
} as const satisfies Record<Milestone, string>;
