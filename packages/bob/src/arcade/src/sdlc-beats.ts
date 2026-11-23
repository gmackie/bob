import { itemAttention, STATE_EDGES } from "@bob/sdlc-view";
import type { EdgeView, ItemSnapshot, ItemState, PlanSnapshot } from "@bob/sdlc-view";

import type { Beat, BeatKind } from "./beat";

const LOOP_EDGES = new Set(STATE_EDGES.filter((e) => e.loop).map((e) => `${e.from}>${e.to}`));
const KIND_ORDER: Record<BeatKind, number> = {
  gap: 0,
  "item.entered": 1,
  "item.advanced": 2,
  "item.looped": 3,
  "item.needs_human": 4,
  "item.failed": 5,
  "release.stage": 6,
  milestone: 7,
  "item.left": 8,
  // Attempt beats never come from sdlcBeats; listed so the order is total.
  "agent.activity": 9,
  "agent.action": 10,
  "ci.phase": 11,
  "ci.green": 12,
};

const issueOf = (plan: PlanSnapshot | undefined, itemId: string) =>
  plan?.definition.items.find((d) => d.itemId === itemId)?.issue.identifier ?? undefined;

function stateKind(from: ItemState, item: ItemSnapshot): BeatKind {
  if (item.state === "failed") return "item.failed";
  if (LOOP_EDGES.has(`${from}>${item.state}`)) return "item.looped";
  if (itemAttention(item) === "needs_human") return "item.needs_human";
  return "item.advanced";
}

/**
 * The beats between two edge views (BOB-91). Pure: the same pair always yields the same
 * beats in the same order, and their ids are stable, so a store can dedupe a replay.
 *
 * - Beats only come from a forward move inside one epoch. The first snapshot, and a
 *   snapshot from a reset edge (a new epoch), are a new baseline: nothing is celebrated
 *   just because the screen opened or the edge restarted.
 * - A view that starts needing a resync (the edge skipped a seq) yields one gap beat.
 */
export function sdlcBeats(prev: EdgeView, next: EdgeView, at: number): Beat[] {
  if (next.epoch === null || prev.epoch !== next.epoch || next.seq <= prev.seq) return [];
  const epoch = next.epoch;
  const seq = next.seq;
  const out: Beat[] = [];
  const push = (kind: BeatKind, item: ItemSnapshot, plan: PlanSnapshot | undefined, data?: Beat["data"], tag = "") => {
    out.push({
      id: `sdlc:${epoch}:${seq}:${item.itemId}:${kind}${tag}`,
      source: "sdlc",
      epoch,
      seq,
      at,
      kind,
      subject: {
        itemId: item.itemId,
        planId: item.planId,
        issue: issueOf(plan, item.itemId),
        ...(item.release?.pullRequest ? { pr: item.release.pullRequest.number } : {}),
        ...(item.release?.mergeSha ? { sha: item.release.mergeSha } : item.release?.headSha ? { sha: item.release.headSha } : {}),
        ...(item.release?.deploymentId ? { deploymentId: item.release.deploymentId } : {}),
      },
      ...(data ? { data } : {}),
    });
  };

  if (next.needsResync && !prev.needsResync) {
    out.push({ id: `sdlc:${epoch}:${seq}:gap`, source: "sdlc", epoch, seq, at, kind: "gap", subject: {}, data: { after: prev.seq } });
  }

  for (const item of Object.values(next.items)) {
    const plan = next.plans[item.planId];
    const before = prev.items[item.itemId];
    if (!before) {
      push("item.entered", item, plan, { state: item.state });
      continue;
    }
    if (before.state !== item.state) push(stateKind(before.state, item), item, plan, { from: before.state, to: item.state });
    const fromStage = before.release?.stage ?? null;
    const toStage = item.release?.stage ?? null;
    if (toStage && fromStage !== toStage) {
      push("release.stage", item, plan, { from: fromStage, to: toStage });
      if (toStage === "checks-failed" && item.state !== "failed") push("item.failed", item, plan, { stage: toStage }, ":release");
    }
    const had = new Set(before.achievedMilestones);
    for (const m of item.achievedMilestones) if (!had.has(m)) push("milestone", item, plan, { milestone: m }, `:${m}`);
  }

  for (const before of Object.values(prev.items)) {
    if (!next.items[before.itemId]) push("item.left", before, prev.plans[before.planId], { state: before.state });
  }

  return out.sort((a, b) =>
    (a.subject.itemId ?? "").localeCompare(b.subject.itemId ?? "") || KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || a.id.localeCompare(b.id),
  );
}
