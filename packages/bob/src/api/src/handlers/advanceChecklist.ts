// Checklist-driven execution driver.
//
// Sibling to autoDrainBacklog: a server-side tick (Cloudflare Cron on the bob
// worker, gated on BOB_ADVANCE_CHECKLIST_ENABLED) that walks each ACTIVE plan's
// ordered planTaskItems one at a time. The pure decision (advanceChecklist-core)
// says what to do next; this shell performs the DB reads/writes and dispatches
// agents via executeTask — the same path manual dispatch and autoDrain use.
//
// The agent never advances the checklist itself: it edits files for ONE item;
// the server reads its session status, evaluates that item's gate, and only then
// marks the item done and moves on. This is the durable fix for agents
// self-certifying completion.

import { and, asc, desc, eq } from "@bob/db";
import { db } from "@bob/db/client";
import {
  chatConversations,
  forgeBuilds,
  forgeRevisions,
  planTaskItems,
  taskRuns,
  worktreePlans,
} from "@bob/db/schema";

import {
  agentFinishedFromWorkflow,
  decideChecklistAction,
  gateSpecSchema,
  type ChecklistItemState,
  type GateSpec,
} from "./advanceChecklist-core";

export interface AdvanceChecklistOptions {
  /** Max plans to advance per tick (one action each). */
  maxPlans?: number;
  /** Failed-gate reprompts before an item is blocked for a human. */
  maxAttempts?: number;
}

export interface AdvanceChecklistResult {
  plansSeen: number;
  actions: { planId: string; action: string; itemId?: string }[];
}

type PlanItemRow = typeof planTaskItems.$inferSelect;

// Resolve whether the item's agent has finished its turn by reading the linked
// session's workflowStatus (plain-uuid join; no Drizzle relation exists).
async function itemAgentFinished(item: PlanItemRow): Promise<boolean> {
  if (!item.sessionId) return false;
  const session = await db.query.chatConversations.findFirst({
    where: eq(chatConversations.id, item.sessionId),
    columns: { workflowStatus: true },
  });
  return agentFinishedFromWorkflow(session?.workflowStatus);
}

// Evaluate an item's gate from rows another process wrote (the worker can't run
// commands). Deterministic tiers first:
//   - ci: the CI build for this item's run must have passed.
//   - test/build/null: fall back to the run's coarse outcome until the daemon
//     reports a per-item gate result into planTaskItems.gateOutcome directly.
//   - reviewer/human: not yet auto-evaluable here (P2 wires the reviewer bot /
//     human sign-off) → "pending" leaves the item in place without looping.
// Returns "pass" | "fail" | "pending".
async function evaluateGate(
  item: PlanItemRow,
): Promise<"pass" | "fail" | "pending"> {
  // A per-item outcome already reported by the execution side wins outright.
  if (item.gateOutcome === "pass" || item.gateOutcome === "fail") {
    return item.gateOutcome;
  }

  let gate: GateSpec | null = null;
  if (item.gate != null) {
    const parsed = gateSpecSchema.safeParse(item.gate);
    if (parsed.success) gate = parsed.data;
  }

  // The run bridges an item's session to CI: item.sessionId → taskRuns.sessionId.
  const run = item.sessionId
    ? await db.query.taskRuns.findFirst({
        where: eq(taskRuns.sessionId, item.sessionId),
        columns: { id: true, status: true },
        orderBy: [desc(taskRuns.createdAt)],
      })
    : null;

  if (gate?.kind === "human") {
    // Human sign-off gate (P2): hold at "pending" until a person resolves it via
    // the plan.resolveGate RPC, which sets gateOutcome — read at the very top of
    // this function. The driver's existing wait/hold semantics give pause/resume
    // for free; nothing else to do here.
    return "pending";
  }
  if (gate?.kind === "reviewer") {
    // Reviewer-agent gate: dispatch an item-scoped reviewer that writes
    // gateOutcome, then read it here. Not yet wired (needs the item-scoped
    // reviewer dispatch — the PR-bound dispatchReviewSession can't be reused for
    // a mid-plan item with no PR). Holds at "pending" until then.
    return "pending";
  }

  if (gate?.kind === "ci") {
    if (!run) return "pending";
    const rev = await db.query.forgeRevisions.findFirst({
      where: eq(forgeRevisions.taskRunId, run.id),
      columns: { id: true },
      orderBy: [desc(forgeRevisions.createdAt)],
    });
    if (!rev) return "pending";
    const build = await db.query.forgeBuilds.findFirst({
      where: eq(forgeBuilds.revisionId, rev.id),
      columns: { status: true },
      orderBy: [desc(forgeBuilds.createdAt)],
    });
    if (!build) return "pending";
    if (build.status === "passed") return "pass";
    if (build.status === "failed" || build.status === "canceled") return "fail";
    return "pending"; // queued / running / superseded
  }

  // test / build / default: use the run's coarse outcome as the gate until the
  // daemon reports per-item results into gateOutcome.
  if (run?.status === "completed") return "pass";
  if (run?.status === "failed" || run?.status === "blocked") return "fail";
  return "pending";
}

// Dispatch (or re-dispatch, for repair) an agent scoped to a single item.
async function dispatchItem(
  plan: typeof worktreePlans.$inferSelect,
  item: PlanItemRow,
  opts: { repair: boolean },
): Promise<void> {
  const { executeTask } = await import("@bob/execution/runtime/taskExecutor");

  const preamble = [
    `You are working a SINGLE checklist item for plan "${plan.title ?? plan.filePath}".`,
    opts.repair
      ? `This item's gate did NOT pass on the previous attempt. Fix it.`
      : ``,
    ``,
    `## The item`,
    item.content,
    item.acceptanceCriteria
      ? `\n## Acceptance criteria\n${item.acceptanceCriteria}`
      : ``,
    ``,
    `## Rules`,
    `- Do ONLY this item. Do not start later items.`,
    `- Edit files in the working tree. Do NOT run git (no branch/commit/push) and`,
    `  do NOT open a PR — the server owns version control and gating.`,
    `- When done, stop; the server verifies the gate.`,
  ]
    .filter(Boolean)
    .join("\n");

  const result = await executeTask(
    plan.userId,
    {
      id: item.id,
      identifier: item.taskKey,
      title: item.content.slice(0, 120),
      description: item.content,
      workspaceId: "",
      projectId: "",
      assigneeId: null,
      labels: [],
      priority: 0,
    },
    { contextPreamble: preamble },
  );

  await db
    .update(planTaskItems)
    .set({
      status: "in_progress",
      sessionId: result.sessionId || null,
      gateOutcome: null,
      ...(opts.repair ? { gateAttempts: (item.gateAttempts ?? 0) + 1 } : {}),
    })
    .where(eq(planTaskItems.id, item.id));
}

/** Advance one plan by a single action. Returns the action taken. */
async function advanceOnePlan(
  plan: typeof worktreePlans.$inferSelect,
  maxAttempts: number,
): Promise<{ action: string; itemId?: string }> {
  const items = await db.query.planTaskItems.findMany({
    where: eq(planTaskItems.planId, plan.id),
    orderBy: [asc(planTaskItems.sortOrder)],
  });

  const states: ChecklistItemState[] = [];
  for (const it of items) {
    states.push({
      id: it.id,
      sortOrder: it.sortOrder,
      status: it.status as ChecklistItemState["status"],
      agentFinished:
        it.status === "in_progress" ? await itemAgentFinished(it) : false,
      gateOutcome:
        it.gateOutcome === "pass" || it.gateOutcome === "fail"
          ? it.gateOutcome
          : null,
      gateAttempts: it.gateAttempts ?? 0,
    });
  }

  const action = decideChecklistAction(states, { maxAttempts });
  const itemById = new Map(items.map((i) => [i.id, i]));

  switch (action.type) {
    case "complete": {
      await db
        .update(worktreePlans)
        .set({ status: "completed" })
        .where(eq(worktreePlans.id, plan.id));
      return { action: "complete" };
    }
    case "wait":
      return { action: "wait" };
    case "dispatch": {
      const item = itemById.get(action.itemId);
      if (item) await dispatchItem(plan, item, { repair: false });
      return { action: "dispatch", itemId: action.itemId };
    }
    case "run_gate": {
      const item = itemById.get(action.itemId);
      if (!item) return { action: "run_gate" };
      const outcome = await evaluateGate(item);
      if (outcome !== "pending") {
        await db
          .update(planTaskItems)
          .set({ gateOutcome: outcome })
          .where(eq(planTaskItems.id, item.id));
      }
      return { action: `run_gate:${outcome}`, itemId: action.itemId };
    }
    case "advance": {
      await db
        .update(planTaskItems)
        .set({ status: "completed", completedAt: new Date().toISOString() })
        .where(eq(planTaskItems.id, action.itemId));
      return { action: "advance", itemId: action.itemId };
    }
    case "repair": {
      const item = itemById.get(action.itemId);
      if (item) await dispatchItem(plan, item, { repair: true });
      return { action: "repair", itemId: action.itemId };
    }
    case "block": {
      // Leave the item in_progress; the attempt cap stops further repair. A
      // human picks it up. (A dedicated blocked marker lands with the human-gate
      // tier in P2.)
      console.warn(
        `[advance-checklist] item ${action.itemId} blocked: ${action.reason}`,
      );
      return { action: "block", itemId: action.itemId };
    }
  }
}

/**
 * One driver tick: advance each ACTIVE plan by a single action. Idempotent and
 * safe to run every cron fire; does nothing to plans with no actionable item.
 */
export async function advanceChecklist(
  opts: AdvanceChecklistOptions = {},
): Promise<AdvanceChecklistResult> {
  const maxPlans = opts.maxPlans ?? 10;
  const maxAttempts = opts.maxAttempts ?? 3;

  const plans = await db.query.worktreePlans.findMany({
    where: eq(worktreePlans.status, "active"),
    orderBy: [asc(worktreePlans.createdAt)],
    limit: maxPlans,
  });

  const actions: AdvanceChecklistResult["actions"] = [];
  for (const plan of plans) {
    try {
      const res = await advanceOnePlan(plan, maxAttempts);
      actions.push({ planId: plan.id, ...res });
    } catch (err) {
      console.error(`[advance-checklist] plan ${plan.id} failed:`, err);
    }
  }

  return { plansSeen: plans.length, actions };
}
