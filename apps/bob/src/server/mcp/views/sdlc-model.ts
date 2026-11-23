// Pure view models for ui://bob/sdlc.html: a T3 thread's SDLC item, or the fleet.
// The view folds the edge socket itself; these turn its EdgeView into what it draws.
import type { EdgeConnection } from "~/components/sdlc/edge-client";
import {
  ITEM_STATES,
  MILESTONES,
  MILESTONE_LABEL,
  STATE_PRESENTATION,
  TERMINAL_PLAN_STATES,
  isOffline,
  type Attention,
  type CiMessage,
  type CiPhase,
  type EdgeView,
  type ItemSnapshot,
  type ItemState,
  type IssueRef,
  type PendingQuestion,
  type PlanSnapshot,
  type PlanState,
  type TailFrame,
} from "@bob/sdlc-view";

/** One item's live detail from the edge socket (Bob's AttemptState, for one item). */
export type AttemptDetail = { tail?: TailFrame; tailUnavailable?: string; ci?: CiMessage };

export type EdgeStatus = { connection: EdgeConnection | "idle"; error?: string; offline: boolean; refreshedAt: string; refreshSeconds: number };

export type SdlcThreadItem = {
  itemId: string;
  planId: string;
  planState: PlanState | "unknown";
  issue?: { identifier?: string; url?: string; issueId: string };
  repository?: string;
  state: ItemState;
  stateLabel: string;
  stateHint: string;
  attention: Attention;
  attemptId?: string;
  milestones: { id: string; label: string; achieved: boolean }[];
  pendingQuestions: PendingQuestion[];
  tail?: { lines: string[]; threadStatus: string; at: string };
  tailUnavailable?: string;
  ci?: { available: true; sha: string; summary: string; phases: CiPhase[]; at: string } | { available: false; reason: string; at: string };
};

export type SdlcThreadData = EdgeStatus & { scope: "thread"; threadId: string; item: SdlcThreadItem | null };

export type FleetPlan = { planId: string; state: PlanState; total: number; completed: number; failed: number; active: number };
export type FleetAttention = { itemId: string; planId: string; identifier?: string; state: ItemState; stateLabel: string; attention: Exclude<Attention, "ok">; threadId?: string };
export type SdlcFleetData = EdgeStatus & {
  scope: "fleet";
  totalItems: number;
  counts: { state: ItemState; label: string; count: number }[];
  attention: FleetAttention[];
  plans: FleetPlan[];
};

export type SdlcData = SdlcThreadData | SdlcFleetData;

const ACTIVE_STATES: ReadonlySet<ItemState> = new Set(["reserved", "running", "waiting-input", "execution-unknown", "validating", "review", "deploying"]);
const definitionOf = (plan: PlanSnapshot | undefined, itemId: string) => plan?.definition.items.find((def) => def.itemId === itemId);

/**
 * The item a T3 thread is running: execution.thread.threadId equals the thread.
 * Retries reuse an item, so at most one item normally matches; if several do,
 * prefer one in a live (non-terminal) state, then the newest resourceVersion.
 */
export function itemForThread(view: EdgeView, threadId: string): ItemSnapshot | null {
  const matches = Object.values(view.items).filter((item) => item.execution?.thread.threadId === threadId);
  const live = (item: ItemSnapshot) => (ACTIVE_STATES.has(item.state) ? 1 : 0);
  matches.sort((a, b) => live(b) - live(a) || b.resourceVersion - a.resourceVersion);
  return matches[0] ?? null;
}

const issueOf = (issue: IssueRef | undefined) =>
  issue ? { issueId: issue.issueId, ...(issue.identifier ? { identifier: issue.identifier } : {}), ...(issue.url ? { url: issue.url } : {}) } : undefined;

export function threadItem(view: EdgeView, item: ItemSnapshot, detail: AttemptDetail = {}): SdlcThreadItem {
  const plan = view.plans[item.planId];
  const def = definitionOf(plan, item.itemId);
  const presentation = STATE_PRESENTATION[item.state];
  const issue = issueOf(def?.issue);
  const ci = detail.ci
    ? detail.ci.available
      ? { available: true as const, sha: detail.ci.sha, summary: detail.ci.summary, phases: detail.ci.phases, at: detail.ci.at }
      : { available: false as const, reason: detail.ci.reason, at: detail.ci.at }
    : undefined;
  return {
    itemId: item.itemId,
    planId: item.planId,
    planState: plan?.state ?? "unknown",
    ...(issue ? { issue } : {}),
    ...(def ? { repository: def.target.repository.repositoryId } : {}),
    state: item.state,
    stateLabel: presentation.label,
    stateHint: presentation.hint,
    attention: presentation.attention,
    ...(item.execution?.attemptId ? { attemptId: item.execution.attemptId } : {}),
    milestones: MILESTONES.map((id) => ({ id, label: MILESTONE_LABEL[id], achieved: item.achievedMilestones.includes(id) })),
    pendingQuestions: item.state === "waiting-input" ? (item.pendingInput?.questions ?? []) : [],
    // A tail from an earlier attempt is not this attempt's output.
    ...(detail.tail && (!item.execution || detail.tail.attemptId === item.execution.attemptId)
      ? { tail: { lines: detail.tail.lines, threadStatus: detail.tail.threadStatus, at: detail.tail.at } }
      : {}),
    ...(detail.tailUnavailable ? { tailUnavailable: detail.tailUnavailable } : {}),
    ...(ci ? { ci } : {}),
  };
}

const ATTENTION_ORDER: Record<Attention, number> = { needs_human: 0, failed: 1, stalled: 2, ok: 3 };

export function fleet(view: EdgeView): Omit<SdlcFleetData, keyof EdgeStatus | "scope"> {
  const items = Object.values(view.items).filter((item) => view.plans[item.planId] && !TERMINAL_PLAN_STATES.has(view.plans[item.planId]!.state));
  const tally = new Map<ItemState, number>();
  for (const item of items) tally.set(item.state, (tally.get(item.state) ?? 0) + 1);
  const attention: FleetAttention[] = items
    .filter((item) => STATE_PRESENTATION[item.state].attention !== "ok")
    .map((item) => {
      const identifier = definitionOf(view.plans[item.planId], item.itemId)?.issue.identifier;
      const threadId = item.execution?.thread.threadId;
      return {
        itemId: item.itemId,
        planId: item.planId,
        ...(identifier ? { identifier } : {}),
        state: item.state,
        stateLabel: STATE_PRESENTATION[item.state].label,
        attention: STATE_PRESENTATION[item.state].attention as Exclude<Attention, "ok">,
        ...(threadId ? { threadId } : {}),
      };
    })
    .sort((a, b) => ATTENTION_ORDER[a.attention] - ATTENTION_ORDER[b.attention] || a.itemId.localeCompare(b.itemId));
  const plans = Object.values(view.plans)
    .map((plan) => {
      const planItems = plan.definition.items.map((def) => view.items[def.itemId]);
      return {
        planId: plan.planId,
        state: plan.state,
        total: plan.definition.items.length,
        completed: planItems.filter((item) => item?.state === "completed").length,
        failed: planItems.filter((item) => item?.state === "failed").length,
        active: planItems.filter((item) => item && ACTIVE_STATES.has(item.state)).length,
      };
    })
    .sort((a, b) => a.planId.localeCompare(b.planId));
  return {
    totalItems: items.length,
    counts: ITEM_STATES.filter((state) => tally.has(state)).map((state) => ({ state, label: STATE_PRESENTATION[state].label, count: tally.get(state)! })),
    attention,
    plans,
  };
}

export function edgeStatus(source: { view: EdgeView; connection: EdgeConnection | "idle"; error: string | null }, refreshSeconds: number, now = Date.now()): EdgeStatus {
  return {
    connection: source.connection,
    ...(source.error ? { error: source.error } : {}),
    offline: isOffline(source.view, now),
    refreshedAt: new Date(now).toISOString(),
    refreshSeconds,
  };
}
