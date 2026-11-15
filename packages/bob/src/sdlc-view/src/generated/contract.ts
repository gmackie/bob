// Generated from packages/bob/coordination/generated/openapi.json. Do not edit.
// Regenerate: pnpm --filter @bob/sdlc-view generate
export const ITEM_STATES = [
  "pending",
  "ready",
  "reserved",
  "running",
  "waiting-input",
  "execution-unknown",
  "validating",
  "review",
  "deploying",
  "failed",
  "cancelling",
  "cancelled",
  "completed",
] as const;
export const PLAN_STATES = [
  "draft",
  "active",
  "paused",
  "cancelling",
  "cancelled",
  "completed",
] as const;
export const MILESTONES = [
  "execution-succeeded",
  "review-ready",
  "merged",
  "production-verified",
] as const;
export const RELEASE_STAGES = [
  "awaiting-publish",
  "checks-running",
  "checks-failed",
  "review-ready",
  "merged",
  "deploying",
  "production-verified",
  "blocked",
] as const;
export type ItemState = (typeof ITEM_STATES)[number];
export type PlanState = (typeof PLAN_STATES)[number];
export type Milestone = (typeof MILESTONES)[number];
export type ReleaseStage = (typeof RELEASE_STAGES)[number];
