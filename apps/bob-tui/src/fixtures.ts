// A fake edge view for tests and `bob-tui demo`: plans in draft, active and paused, and
// items in validating, failed, execution-unknown, waiting-input, running and pending.
import { emptyView, reduce, type EdgeView, type ItemSnapshot, type ItemState, type Milestone, type PlanSnapshot, type PlanState } from "@bob/sdlc-view";

export const FIXTURE_NOW = Date.parse("2026-11-15T12:00:00Z");

const target = (repositoryId: string) => ({
  environmentId: "env-hetzner-bob",
  projectId: "proj-1",
  repository: { integrationId: "forgegraph", repositoryId },
});
const issue = (identifier: string) => ({
  integrationId: "kanbanger", workspaceId: "ws", teamId: "team", projectId: "p", issueId: `issue-${identifier}`, identifier,
  url: `https://tasks.gmac.io/issue/${identifier}`,
});

type Def = { id: string; key: string; repo: string };
function plan(planId: string, state: PlanState, defs: Def[], deps: Array<[string, string, Milestone?]> = []): PlanSnapshot {
  return {
    planId, resourceVersion: 3, state,
    definition: {
      items: defs.map((d) => ({ itemId: d.id, issue: issue(d.key), target: target(d.repo), completionTarget: "merged" })),
      dependencies: deps.map(([u, d, m]) => ({ upstreamItemId: u, downstreamItemId: d, requiredMilestone: m ?? "execution-succeeded" })),
      concurrencyLimit: 2,
    },
  };
}

function item(itemId: string, planId: string, state: ItemState, extra: Partial<ItemSnapshot> = {}): ItemSnapshot {
  return { itemId, planId, resourceVersion: 5, state, achievedMilestones: [], operationIds: [], evidenceRefs: [], ...extra };
}

const thread = (threadId: string) => ({ environmentId: "env-hetzner-bob", projectId: "proj-1", threadId });

export const PLAN_ACTIVE = "a1c7e5f0-0000-4000-8000-000000000001";
export const PLAN_PAUSED = "b2d8f6a1-0000-4000-8000-000000000002";
export const PLAN_DRAFT = "c3e9a7b2-0000-4000-8000-000000000003";

export function fixtureView(): EdgeView {
  const plans = [
    plan(PLAN_ACTIVE, "active", [
      { id: "item-a1", key: "BOB-71", repo: "gmackie/bob" },
      { id: "item-a2", key: "BOB-72", repo: "gmackie/bob" },
      { id: "item-a3", key: "BOB-73", repo: "gmackie/bob" },
      { id: "item-a4", key: "BOB-74", repo: "gmackie/bob" },
    ], [["item-a1", "item-a2"], ["item-a1", "item-a3", "merged"], ["item-a2", "item-a4"], ["item-a3", "item-a4"]]),
    plan(PLAN_PAUSED, "paused", [
      { id: "item-p1", key: "FORGE-12", repo: "gmackie/forgegraph" },
      { id: "item-p2", key: "FORGE-13", repo: "gmackie/forgegraph" },
    ], [["item-p1", "item-p2"]]),
    plan(PLAN_DRAFT, "draft", [{ id: "item-d1", key: "BOB-80", repo: "gmackie/bob" }]),
  ];
  const items = [
    item("item-a1", PLAN_ACTIVE, "validating", {
      execution: { attemptId: "att-a1", target: target("gmackie/bob"), thread: thread("thr-71") },
      achievedMilestones: ["execution-succeeded"], evidenceRefs: ["https://git.forgegraf.com/gmackie/bob/pulls/292", "ci:run/8812"],
    }),
    item("item-a2", PLAN_ACTIVE, "failed", { execution: { attemptId: "att-a2", target: target("gmackie/bob"), thread: thread("thr-72") } }),
    item("item-a3", PLAN_ACTIVE, "execution-unknown", { execution: { attemptId: "att-a3", target: target("gmackie/bob"), thread: thread("thr-73") } }),
    item("item-a4", PLAN_ACTIVE, "pending"),
    item("item-p1", PLAN_PAUSED, "waiting-input", { execution: { attemptId: "att-p1", target: target("gmackie/forgegraph"), thread: thread("thr-12") } }),
    item("item-p2", PLAN_PAUSED, "pending"),
  ];
  return reduce(emptyView(), {
    type: "snapshot", epoch: "epoch-1", seq: 10, plans, items,
    topology: [
      { startupId: "s-bob", startupName: "Bob", repoSlug: "gmackie/bob" },
      { startupId: "s-forge", startupName: "ForgeGraph", repoSlug: "gmackie/forgegraph" },
    ],
    coordinatorSeenAt: FIXTURE_NOW - 5_000,
  });
}
