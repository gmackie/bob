/**
 * iOS Live Activity for an SDLC item (BOB-96, the Arcade's "Glance", BOB-91).
 *
 * The app starts an ActivityKit activity for an item and registers the activity's push
 * token with the edge over its socket (LiveActivityRegistration). The edge then sends APNs
 * `liveactivity` pushes whose content-state is LiveActivityContent when the item moves, and
 * an end event when it completes, fails or is cancelled. The content carries no agent text:
 * no question, no answer, no tail. It is what a lock screen may show.
 */
import type { ItemState } from "./generated/contract";
import type { ItemSnapshot, PlanSnapshot } from "./model";
import { itemAttention, STATE_PRESENTATION } from "./presentation";

/** Client → edge: register (token) or stop (token null) the activity for an item. */
export interface LiveActivityRegistration { type: "liveActivity"; itemId: string; token: string | null }

/** The stage dots on the activity, in order. */
export const LIVE_ACTIVITY_STAGES = ["Queued", "Agent", "CI", "Review", "Deploy", "Shipped"] as const;

const STAGE_OF: Record<ItemState, number> = {
  pending: 0, ready: 0, reserved: 0, "execution-unknown": 0,
  running: 1, "waiting-input": 1,
  validating: 2,
  review: 3,
  deploying: 4,
  completed: 5,
  failed: 0, cancelling: 0, cancelled: 0,
};
const ENDS = new Set<ItemState>(["completed", "failed", "cancelled"]);

/** The ActivityKit content-state. Keys are short: APNs liveactivity payloads are capped at 4 KB. */
export interface LiveActivityContent {
  /** Tracker identifier, e.g. "BOB-96", else null. */
  issue: string | null;
  repository: string | null;
  state: ItemState;
  /** STATE_PRESENTATION label, e.g. "Waiting for input". */
  label: string;
  /** Index into LIVE_ACTIVITY_STAGES. For failed and cancelled, the stage reached is unknown: 0. */
  stage: number;
  needsYou: boolean;
  failed: boolean;
  /** The activity should end. */
  ended: boolean;
}

export function liveActivityContent(item: ItemSnapshot, plan: PlanSnapshot | undefined): LiveActivityContent {
  const def = plan?.definition.items.find((d) => d.itemId === item.itemId);
  const attention = itemAttention(item);
  return {
    issue: def?.issue.identifier ?? null,
    repository: item.execution?.target.repository.repositoryId ?? def?.target.repository.repositoryId ?? null,
    state: item.state,
    label: STATE_PRESENTATION[item.state].label,
    stage: STAGE_OF[item.state],
    needsYou: attention === "needs_human",
    failed: attention === "failed",
    ended: ENDS.has(item.state),
  };
}

/** Limits the edge applies to registrations and sends. */
export const LIVE_ACTIVITY_LIMITS = {
  /** Activities one user may have registered; registering more drops their oldest. */
  perUser: 8,
  /** ActivityKit ends an activity after 8 hours; tokens older than this are forgotten. */
  tokenTtlMs: 8 * 60 * 60_000,
  /** Updates to one activity closer together than this are coalesced (needs-you and end are never held back). */
  minIntervalMs: 15_000,
} as const;

/** An ActivityKit push token: hex, as the app reads it from Activity.pushTokenUpdates. */
export const isActivityToken = (token: unknown): token is string => typeof token === "string" && /^[0-9a-f]{32,256}$/i.test(token);
