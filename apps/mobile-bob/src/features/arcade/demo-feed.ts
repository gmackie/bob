// A scripted SDLC edge for the Arcade's dev-only demo mode (/arcade?demo=1 in __DEV__).
// It emits real EdgeMessages (a snapshot, then deltas) that go through the same reduce()
// → sdlcBeats() → floorScene() pipeline as the live edge, so the demo exercises the real
// code. Items and identifiers are fake; the screen labels the feed DEMO.
import type { EdgeMessage, ItemSnapshot, ItemState, Milestone, PlanSnapshot, ReleaseStage } from "@bob/sdlc-view";

interface Step {
  item: number;
  state: ItemState;
  stage?: ReleaseStage;
  milestone?: Milestone;
}

const REPOS = ["bob", "forgegraph", "kanbanger"] as const;

/** Index into a list the script built itself; an out-of-range index is a bug in the script. */
function at<T>(list: readonly T[], index: number): T {
  const value = list[index];
  if (value === undefined) throw new Error(`demo feed: index ${index} out of range`);
  return value;
}
const ITEMS = 9;
const ids = Array.from({ length: ITEMS }, (_, i) => `demo-${i}`);
const identifier = (i: number) => `BOB-${101 + i}`;

function planSnapshot(epoch: string): PlanSnapshot {
  return {
    planId: `demo-plan-${epoch}`,
    resourceVersion: 1,
    state: "active",
    definition: {
      items: ids.map((itemId, i) => ({
        itemId,
        issue: { integrationId: "kanbanger", workspaceId: "demo", teamId: "demo", projectId: "demo", issueId: itemId, identifier: identifier(i) },
        target: { environmentId: "demo", projectId: "demo", repository: { integrationId: "forgegraph", repositoryId: at(REPOS, i % REPOS.length) } },
        completionTarget: "production-verified",
      })),
      dependencies: [],
      concurrencyLimit: 4,
    },
  };
}

/** One item's happy path, with a review loop or a CI miss for some. */
function journey(i: number): Omit<Step, "item">[] {
  const steps: Omit<Step, "item">[] = [
    { state: "ready" },
    { state: "reserved" },
    { state: "running" },
  ];
  if (i % 4 === 1) steps.push({ state: "waiting-input" }, { state: "running" });
  steps.push({ state: "validating", stage: "checks-running", milestone: "execution-succeeded" });
  if (i % 5 === 3) {
    steps.push({ state: "validating", stage: "checks-failed" }, { state: "failed", stage: "checks-failed" });
    return steps;
  }
  steps.push({ state: "review", stage: "review-ready", milestone: "review-ready" });
  if (i % 3 === 2) steps.push({ state: "validating", stage: "checks-running" }, { state: "review", stage: "review-ready" });
  steps.push({ state: "deploying", stage: "deploying", milestone: "merged" }, { state: "completed", stage: "production-verified", milestone: "production-verified" });
  return steps;
}

/** Interleaves the journeys, staggered, into one deterministic schedule. */
export function demoSchedule(): Step[] {
  const queues = ids.map((_, i) => journey(i).map((s) => ({ ...s, item: i })));
  const out: Step[] = [];
  for (let tick = 0; out.length < queues.reduce((n, q) => n + q.length, 0); tick++) {
    queues.forEach((q, i) => {
      const k = tick - i * 2;
      if (k >= 0 && k < q.length) out.push(at(q, k));
    });
  }
  return out;
}

export interface DemoFeed {
  snapshot: EdgeMessage;
  deltas: EdgeMessage[];
}

/** The whole demo run for one epoch: every item starts pending, then the schedule plays. */
export function demoFeed(epoch: string, seenAt: number): DemoFeed {
  const plan = planSnapshot(epoch);
  const items = new Map<string, ItemSnapshot>(
    ids.map((itemId) => [itemId, { itemId, planId: plan.planId, resourceVersion: 1, state: "pending", release: null, achievedMilestones: [], operationIds: [], evidenceRefs: [] }]),
  );
  const deltas: EdgeMessage[] = demoSchedule().map((s, n) => {
    const prev = items.get(at(ids, s.item));
    if (!prev) throw new Error(`demo feed: no item ${s.item}`);
    const next: ItemSnapshot = {
      ...prev,
      resourceVersion: prev.resourceVersion + 1,
      state: s.state,
      pendingInput:
        s.state === "waiting-input"
          ? {
              attemptId: "a",
              promptId: "demo-prompt",
              kind: "user_input",
              questions: [{ id: "q1", question: "Ship behind a flag or straight to prod?", options: [{ label: "Flag" }, { label: "Straight to prod" }], multiSelect: false }],
              createdAt: "2026-11-18T00:00:00Z",
            }
          : null,
      release: s.stage ? { attemptId: "a", stage: s.stage, autoMerge: true, updatedAt: "2026-11-18T00:00:00Z" } : prev.release,
      achievedMilestones: s.milestone && !prev.achievedMilestones.includes(s.milestone) ? [...prev.achievedMilestones, s.milestone] : prev.achievedMilestones,
    };
    items.set(next.itemId, next);
    return { type: "delta", seq: n + 2, plans: [], items: [next], coordinatorSeenAt: seenAt };
  });
  return {
    snapshot: { type: "snapshot", epoch, seq: 1, plans: [plan], items: ids.map((id) => ({ itemId: id, planId: plan.planId, resourceVersion: 1, state: "pending" as const, release: null, achievedMilestones: [], operationIds: [], evidenceRefs: [] })), topology: [], coordinatorSeenAt: seenAt },
    deltas,
  };
}
