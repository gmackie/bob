// Test-only builders for edge views. Not imported by app code.
import { emptyView, reduce       } from "@bob/sdlc-view";
import type {EdgeView, ItemSnapshot, ItemState, PendingInput, PlanSnapshot, TopologyRepo} from "@bob/sdlc-view";

export interface ItemSpec { itemId: string; state: ItemState; repo?: string; identifier?: string; pendingInput?: PendingInput; attemptId?: string }

export function plan(planId: string, items: ItemSpec[], state: PlanSnapshot["state"] = "active"): PlanSnapshot {
  return {
    planId,
    resourceVersion: 1,
    state,
    definition: {
      items: items.map((i) => ({
        itemId: i.itemId,
        issue: { integrationId: "kanbanger", workspaceId: "w", teamId: "t", projectId: "p", issueId: `iss-${i.itemId}`, identifier: i.identifier ?? i.itemId.toUpperCase() },
        target: { environmentId: "env", projectId: "proj", repository: { integrationId: "forgegraph", repositoryId: i.repo ?? "bob" } },
        completionTarget: "execution",
      })),
      dependencies: [],
      concurrencyLimit: 2,
    },
  };
}

export function item(planId: string, spec: ItemSpec): ItemSnapshot {
  return {
    itemId: spec.itemId,
    planId,
    resourceVersion: 1,
    state: spec.state,
    execution: spec.attemptId
      ? { attemptId: spec.attemptId, target: { environmentId: "env", projectId: "proj", repository: { integrationId: "forgegraph", repositoryId: spec.repo ?? "bob" } }, thread: { environmentId: "env", projectId: "proj", threadId: `th-${spec.itemId}` } }
      : null,
    pendingInput: spec.pendingInput ?? null,
    achievedMilestones: [],
    operationIds: [],
    evidenceRefs: [],
  };
}

export const TOPOLOGY: TopologyRepo[] = [
  { startupId: "s-bob", startupName: "Bob", repoSlug: "gmackie/bob" },
  { startupId: "s-fg", startupName: "ForgeGraph", repoSlug: "gmackie/forgegraph" },
];

export function viewOf(plans: { planId: string; items: ItemSpec[]; state?: PlanSnapshot["state"] }[], coordinatorSeenAt: number | null = 1_000): EdgeView {
  return reduce(emptyView(), {
    type: "snapshot",
    epoch: "e1",
    seq: 1,
    plans: plans.map((p) => plan(p.planId, p.items, p.state)),
    items: plans.flatMap((p) => p.items.map((i) => item(p.planId, i))),
    topology: TOPOLOGY,
    coordinatorSeenAt,
  });
}

export const PENDING: PendingInput = {
  attemptId: "att-1",
  promptId: "prompt-1",
  kind: "user_input",
  createdAt: "2026-11-15T00:00:00Z",
  questions: [
    { id: "q1", question: "Which database?", options: [{ label: "Postgres", value: "pg" }, { label: "SQLite" }], multiSelect: false },
    { id: "q2", question: "Which targets?", options: [{ label: "web" }, { label: "mobile" }], multiSelect: true },
    { id: "q3", question: "Anything else?", options: [], multiSelect: false },
  ],
};

/** The value, or a thrown error naming what was missing (tests only; avoids non-null assertions). */
export function must<T>(value: T | null | undefined, what = "value"): T {
  if (value === null || value === undefined) throw new Error(`expected ${what}`);
  return value;
}
