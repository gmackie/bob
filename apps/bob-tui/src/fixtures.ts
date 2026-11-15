// A fake edge view for tests and `bob-tui demo`: plans in draft, active and paused, and
// items in validating, failed, execution-unknown, waiting-input, running and pending.
import { emptyView, reduce, type EdgeView, type ItemSnapshot, type ItemState, type Milestone, type PendingInput, type PlanSnapshot, type PlanState } from "@bob/sdlc-view";

import { emptyAttempt, type AttemptState } from "./model/attempt";

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

/** The question item-p1 (FORGE-12, waiting-input) is waiting on. */
export const FIXTURE_PENDING: PendingInput = {
  attemptId: "att-p1", promptId: "prompt-p1", kind: "user_input", createdAt: "2026-11-15T11:58:00Z",
  questions: [
    { id: "q-db", header: "Database", question: "Which database should the migration target?", options: [{ label: "Postgres", value: "pg", description: "hetzner-master" }, { label: "SQLite" }], multiSelect: false },
    { id: "q-env", question: "Which stages should it run on?", options: [{ label: "Beta", value: "beta" }, { label: "Production", value: "prod" }], multiSelect: true },
    { id: "q-note", question: "Anything the agent should know?", options: [], multiSelect: false },
  ],
};

/** A live tail for item-a1 and CI for it, plus an unavailable relay for item-p1 (demo and tests). */
export function fixtureAttempt(): AttemptState {
  return {
    ...emptyAttempt(),
    tails: {
      "item-a1": {
        itemId: "item-a1", attemptId: "att-a1", threadId: "thr-71", threadStatus: "running", at: "2026-11-15T11:59:58Z",
        lines: Array.from({ length: 30 }, (_, i) => `[${String(i + 1).padStart(2, "0")}] pnpm vitest run · ${i < 28 ? "ok" : "running"} suite-${i + 1}`),
      },
    },
    ci: {
      "item-a1": {
        type: "ci", itemId: "item-a1", available: true, sha: "9f3c1d2e7a6b5c4d", summary: "2 of 4 phases passed", at: "2026-11-15T11:59:50Z",
        phases: [{ name: "lint", status: "passed" }, { name: "typecheck", status: "passed" }, { name: "test", status: "running" }, { name: "deploy-beta", status: "queued" }],
      },
      "item-p1": { type: "ci", itemId: "item-p1", available: false, reason: "ForgeGraph did not answer", at: "2026-11-15T11:59:50Z" },
    },
    unavailable: { "item-p1": "the relay has not posted for this attempt recently" },
  };
}

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
    item("item-p1", PLAN_PAUSED, "waiting-input", { execution: { attemptId: "att-p1", target: target("gmackie/forgegraph"), thread: thread("thr-12") }, pendingInput: FIXTURE_PENDING }),
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
