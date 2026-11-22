// Demo SDLC edge data, shared by scripts/fake-bob.ts (offline dev-host) and the tests.
import type { CiMessage, EdgeMessage, ItemSnapshot, PlanSnapshot, TailMessage } from "@bob/sdlc-view";

const target = (repositoryId: string) => ({ environmentId: "env-local", projectId: "proj-t3", repository: { integrationId: "forgegraph", repositoryId } });
const issue = (n: number) => ({
  integrationId: "kanbanger",
  workspaceId: "ws",
  teamId: "t3code",
  projectId: "proj-t3",
  issueId: `issue-${n}`,
  identifier: `T3CODE-${n}`,
  url: `https://tasks.example/T3CODE-${n}`,
});

export const DEMO_THREADS = { running: "thread-demo-running", waiting: "thread-demo-waiting", none: "thread-without-item" } as const;

export const demoPlan: PlanSnapshot = {
  planId: "plan-sdlc-demo",
  resourceVersion: 3,
  state: "active",
  definition: {
    items: [
      { itemId: "item-a", issue: issue(201), target: target("gmackie/t3code-bob-plugin"), completionTarget: "production-verified" },
      { itemId: "item-b", issue: issue(202), target: target("gmackie/bob"), completionTarget: "merged" },
      { itemId: "item-c", issue: issue(203), target: target("gmackie/bob"), completionTarget: "merged" },
      { itemId: "item-d", issue: issue(204), target: target("gmackie/bob"), completionTarget: "merged" },
    ],
    dependencies: [{ upstreamItemId: "item-a", downstreamItemId: "item-d", requiredMilestone: "merged" }],
    concurrencyLimit: 2,
  },
};

const thread = (threadId: string) => ({ environmentId: "env-local", projectId: "proj-t3", threadId });

export const demoItems: ItemSnapshot[] = [
  {
    itemId: "item-a",
    planId: demoPlan.planId,
    resourceVersion: 7,
    state: "running",
    currentAttemptId: "att-a1",
    execution: { attemptId: "att-a1", target: target("gmackie/t3code-bob-plugin"), thread: thread(DEMO_THREADS.running) },
    achievedMilestones: [],
    operationIds: [],
    evidenceRefs: [],
  },
  {
    itemId: "item-b",
    planId: demoPlan.planId,
    resourceVersion: 4,
    state: "waiting-input",
    currentAttemptId: "att-b1",
    execution: { attemptId: "att-b1", target: target("gmackie/bob"), thread: thread(DEMO_THREADS.waiting) },
    pendingInput: {
      attemptId: "att-b1",
      promptId: "prompt-1",
      kind: "user_input",
      createdAt: "2026-11-15T10:00:00.000Z",
      questions: [
        { id: "q1", header: "Migration", question: "Run the <drizzle> migration against production now?", options: [{ label: "Yes" }, { label: "Wait for review" }], multiSelect: false },
      ],
    },
    achievedMilestones: [],
    operationIds: [],
    evidenceRefs: [],
  },
  { itemId: "item-c", planId: demoPlan.planId, resourceVersion: 5, state: "completed", achievedMilestones: ["execution-succeeded", "review-ready", "merged"], operationIds: [], evidenceRefs: [] },
  { itemId: "item-d", planId: demoPlan.planId, resourceVersion: 1, state: "pending", achievedMilestones: [], operationIds: [], evidenceRefs: [] },
];

export const demoSnapshot = (coordinatorSeenAt: number | null = Date.now()): EdgeMessage => ({
  type: "snapshot",
  epoch: "epoch-demo",
  seq: 12,
  plans: [demoPlan],
  items: demoItems,
  topology: [],
  coordinatorSeenAt,
});

export const demoTail = (itemId: string): TailMessage | null =>
  itemId === "item-a"
    ? {
        type: "tail",
        frame: {
          itemId,
          attemptId: "att-a1",
          threadId: DEMO_THREADS.running,
          threadStatus: "running",
          at: "2026-11-15T10:05:00.000Z",
          lines: ["$ bun test", "  42 pass", "  0 fail", "Editing src/sdlc/edgeClient.ts"],
        },
      }
    : null;

export const demoCi = (itemId: string): CiMessage =>
  itemId === "item-a"
    ? {
        type: "ci",
        itemId,
        available: true,
        sha: "6a8b23e0f1c2d3",
        summary: "2 of 3 phases passed",
        phases: [
          { name: "typecheck", status: "passed" },
          { name: "test", status: "passed" },
          { name: "deploy-preview", status: "running" },
        ],
        at: "2026-11-15T10:04:00.000Z",
      }
    : { type: "ci", itemId, available: false, reason: "No ForgeGraph changeset yet.", at: "2026-11-15T10:04:00.000Z" };
