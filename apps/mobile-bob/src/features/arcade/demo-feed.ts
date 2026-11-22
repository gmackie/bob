// A scripted SDLC edge for the Arcade's dev-only demo mode (/arcade?demo=1 in __DEV__).
// It emits real EdgeMessages (a snapshot, then deltas) that go through the same reduce()
// → sdlcBeats() → floorScene() pipeline as the live edge, so the demo exercises the real
// code. Items and identifiers are fake; the screen labels the feed DEMO.
import type { DeskDetail } from "@bob/arcade";
import type { CiPhase, EdgeMessage, ItemSnapshot, ItemState, Milestone, PlanSnapshot, ReleaseStage, TrackedIssue } from "@bob/sdlc-view";

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
/** How often the demo plays a step (use-demo-edge), so the script can stamp believable ages. */
export const DEMO_STEP_MS = 1_100;
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

const DAY = 24 * 3_600_000;
type DemoIssueSpec = [key: string, title: string, project: string, state: TrackedIssue["state"], pr: [TrackedPr["state"], TrackedPr["checks"]] | null, ageDays: number];
type TrackedPr = NonNullable<TrackedIssue["pr"]>;
const PROJECTS: Record<string, string> = { demo: "Bob", "demo-forge": "ForgeGraph", "demo-edu": "EducateOS" };
const TODO = { name: "Todo", type: "unstarted" as const };
const DOING = { name: "In Progress", type: "started" as const };
const REVIEW = { name: "In Review", type: "started" as const };
const BACKLOG = { name: "Backlog", type: "backlog" as const };
/** Kanbanger issues around the scripted items (BOB-99), so the demo opens on a projects board. Fake keys and titles. */
const DEMO_ISSUES: DemoIssueSpec[] = [
  ["FORGE-401", "Deploy history pagination", "demo-forge", REVIEW, ["open", "success"], 0.2],
  ["FORGE-402", "Hyperdrive tunnel health probe", "demo-forge", REVIEW, ["merged", "success"], 9],
  ["FORGE-403", "Receipts for manual targets", "demo-forge", DOING, ["open", "pending"], 0.1],
  ["FORGE-404", "CI watch misses fast failures", "demo-forge", DOING, ["open", "failure"], 1],
  ["FORGE-405", "Stage drift report", "demo-forge", REVIEW, null, 21],
  ["FORGE-406", "Node agent upgrade", "demo-forge", TODO, null, 2],
  ["FORGE-407", "Self-host guide refresh", "demo-forge", BACKLOG, null, 40],
  ["SCHO-301", "Gradebook export", "demo-edu", DOING, null, 0.5],
  ["SCHO-302", "Parent portal sign-in", "demo-edu", DOING, null, 12],
  ["SCHO-303", "Attendance sync", "demo-edu", REVIEW, ["open", "success"], 3],
  ["SCHO-304", "Timetable import", "demo-edu", TODO, null, 1],
  ["BOB-120", "Arcade project board", "demo", DOING, ["open", "pending"], 0.05],
  ["BOB-121", "Lock Screen stage track", "demo", BACKLOG, null, 5],
];

/** Demo issues stamped against `seenAt` (ids are fixed fake UUIDs). */
export function demoIssues(seenAt: number): TrackedIssue[] {
  return DEMO_ISSUES.map(([key, title, project, state, pr, ageDays], i) => ({
    id: `00000000-0000-4000-8000-${String(900 + i).padStart(12, "0")}`,
    key,
    title,
    url: null,
    state,
    project: { id: project, name: PROJECTS[project] ?? project },
    team: key.split("-")[0] ?? null,
    updatedAt: Math.round(seenAt - ageDays * DAY),
    pr: pr ? { repo: `demo/${project}`, number: 40 + i, url: `https://git.forgegraf.com/demo/${project}/pulls/${40 + i}`, state: pr[0], checks: pr[1], headSha: null, checkedAt: seenAt } : null,
    dispatchable: project === "demo",
    version: 1,
  }));
}

/** The whole demo run for one epoch: every item starts pending, then the schedule plays. */
export function demoFeed(epoch: string, seenAt: number): DemoFeed {
  const plan = planSnapshot(epoch);
  const items = new Map<string, ItemSnapshot>(
    ids.map((itemId) => [itemId, { itemId, planId: plan.planId, resourceVersion: 1, state: "pending", release: null, achievedMilestones: [], operationIds: [], evidenceRefs: [], stateSince: seenAt }]),
  );
  const deltas: EdgeMessage[] = demoSchedule().map((s, n) => {
    const prev = items.get(at(ids, s.item));
    if (!prev) throw new Error(`demo feed: no item ${s.item}`);
    const next: ItemSnapshot = {
      ...prev,
      resourceVersion: prev.resourceVersion + 1,
      state: s.state,
      // What the edge would stamp (BOB-101): when this step plays, if the state changed.
      stateSince: s.state === prev.state ? prev.stateSince : seenAt + (n + 1) * DEMO_STEP_MS,
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
    snapshot: { type: "snapshot", epoch, seq: 1, plans: [plan], items: ids.map((id) => ({ itemId: id, planId: plan.planId, resourceVersion: 1, state: "pending" as const, release: null, achievedMilestones: [], operationIds: [], evidenceRefs: [], stateSince: seenAt })), topology: [], coordinatorSeenAt: seenAt, issues: demoIssues(seenAt) },
    deltas,
  };
}

const DEMO_WORK = [
  "reading packages/bob/src/arcade/src/desks.ts",
  "editing apps/mobile-bob/src/features/arcade/DesksView.tsx",
  "$ pnpm vitest run test/desks.test.ts (exit 1)",
  "1 failed, 12 passed (13): fixing the rank tie-break",
  "editing packages/bob/src/arcade/src/desks.ts",
  "$ pnpm vitest run test/desks.test.ts (exit 0)",
  "$ pnpm typecheck (exit 0)",
  "$ git commit -m \"arcade: sticky desks\" (exit 0)",
  "$ git push (exit 0)",
  "writing the PR description",
];

/**
 * Dev demo only: scripted desk detail (tail lines, CI phases) for an item in the demo feed,
 * advanced by `tick`. It goes through the same desks() as the live edge. The screen labels
 * the feed DEMO, so no one takes it for real agent output.
 */
export function demoDeskDetail(state: ItemState | undefined, itemId: string, tick: number, now: number): DeskDetail {
  const n = Number(itemId.replace(/\D/g, "")) || 0;
  const at = new Date(now).toISOString();
  if (state === "running" || state === "waiting-input") {
    const end = ((tick + n * 3) % DEMO_WORK.length) + 1;
    const lines = DEMO_WORK.slice(Math.max(0, end - 4), end);
    if (state === "waiting-input") lines.push("asking: Ship behind a flag or straight to prod?");
    return { tail: { itemId, attemptId: "a", threadId: "demo", lines, threadStatus: state === "running" ? "running" : "waiting", at } };
  }
  if (state === "validating" || state === "review" || state === "deploying") {
    const names = ["install", "lint", "typecheck", "test", "build"];
    const done = state === "validating" ? (tick + n) % names.length : names.length;
    const failing = state === "validating" && n % 5 === 3 && done >= 3;
    const phases: CiPhase[] = names.map((name, i) => ({
      name,
      status: i < done ? (failing && i === 3 ? "failed" : "passed") : i === done ? "running" : "queued",
    }));
    const passed = phases.filter((p) => p.status === "passed").length;
    return {
      // A fresh sha per pass, as a real re-run would have: each pass is its own CI run.
      ci: { type: "ci", itemId, available: true, sha: `demo-${Math.floor((tick + n) / names.length)}`, summary: `${passed}/${names.length} passed`, phases, at },
      tailUnavailable: state === "validating" ? "the agent has finished; CI is running" : null,
    };
  }
  return { tailUnavailable: "the agent has not started yet" };
}
