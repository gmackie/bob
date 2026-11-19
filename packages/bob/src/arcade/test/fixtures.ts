import { emptyView, reduce } from "@bob/sdlc-view";
import type { EdgeMessage, EdgeView, ItemSnapshot, ItemState, Milestone, PlanSnapshot, ReleaseStatus } from "@bob/sdlc-view";

export interface Spec { itemId: string; state: ItemState; repo?: string; identifier?: string; release?: Partial<ReleaseStatus> & { stage: ReleaseStatus["stage"] }; milestones?: Milestone[]; rv?: number }

export function plan(planId: string, specs: Spec[], state: PlanSnapshot["state"] = "active", rv = 1): PlanSnapshot {
  return {
    planId,
    resourceVersion: rv,
    state,
    definition: {
      items: specs.map((s) => ({
        itemId: s.itemId,
        issue: { integrationId: "kanbanger", workspaceId: "w", teamId: "t", projectId: "p", issueId: `iss-${s.itemId}`, identifier: s.identifier ?? `BOB-${s.itemId}` },
        target: { environmentId: "env", projectId: "proj", repository: { integrationId: "forgegraph", repositoryId: s.repo ?? "bob" } },
        completionTarget: "production-verified",
      })),
      dependencies: [],
      concurrencyLimit: 3,
    },
  };
}

export function item(planId: string, s: Spec): ItemSnapshot {
  return {
    itemId: s.itemId,
    planId,
    resourceVersion: s.rv ?? 1,
    state: s.state,
    release: s.release ? { attemptId: "a1", autoMerge: false, updatedAt: "2026-11-17T00:00:00Z", ...s.release } : null,
    achievedMilestones: s.milestones ?? [],
    operationIds: [],
    evidenceRefs: [],
  };
}

export function snapshot(specs: Spec[], epoch = "e1", seq = 1): EdgeMessage {
  return { type: "snapshot", epoch, seq, plans: [plan("p1", specs)], items: specs.map((s) => item("p1", s)), topology: [], coordinatorSeenAt: 1 };
}

/** A delta updating some items of plan p1 (each spec's rv must grow for it to apply). */
export function delta(seq: number, specs: Spec[], planState: PlanSnapshot["state"] = "active", planRv = 1): EdgeMessage {
  return { type: "delta", seq, plans: planState === "active" ? [] : [plan("p1", [], planState, planRv)], items: specs.map((s) => item("p1", s)), coordinatorSeenAt: 2 };
}

export const viewOf = (...messages: EdgeMessage[]): EdgeView => messages.reduce(reduce, emptyView());
