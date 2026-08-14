// Pure decision logic for the checklist-driven execution loop.
//
// The advanceChecklist driver (side-effecting: DB, executeTask, gate runs) is a
// thin shell around this. Keeping the walk logic pure — one function that, given
// the ordered items and their runtime signals, returns the single next action —
// makes the load-bearing correctness (strict order, gate-driven advance, bounded
// repair, complete-only-when-all-terminal) unit-testable without a running Bob,
// exactly as autoDrain-pick.ts is split out from autoDrain.ts.

import { z } from "zod";

// A gate is an item's machine-checkable definition-of-done. Deterministic gates
// (test/build/ci) are preferred and un-gameable; reviewer dispatches an
// independent judge; human waits for sign-off.
export const gateSpecSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("test"), command: z.string().min(1) }),
  z.object({ kind: z.literal("build"), command: z.string().min(1).optional() }),
  z.object({ kind: z.literal("ci") }),
  z.object({ kind: z.literal("reviewer"), criteria: z.string().optional() }),
  z.object({ kind: z.literal("human"), prompt: z.string().optional() }),
]);
export type GateSpec = z.infer<typeof gateSpecSchema>;

// Item lifecycle mirrors work-items' taskStatusEnum.
export type ChecklistItemStatus =
  | "pending"
  | "in_progress"
  | "completed"
  | "cancelled";

export type GateOutcome = "pass" | "fail";

export interface ChecklistItemState {
  id: string;
  sortOrder: number;
  status: ChecklistItemStatus;
  /**
   * Runtime signal the driver fills in for the in_progress item: has the agent
   * session finished its turn (so the gate can be evaluated)? Undefined/false
   * means the agent is still working.
   */
  agentFinished?: boolean;
  /** Outcome of the most recent gate run for this item, if one has run. */
  gateOutcome?: GateOutcome | null;
  /** Reprompt/repair attempts already spent after a failed gate. */
  gateAttempts?: number;
}

export type ChecklistAction =
  | { type: "dispatch"; itemId: string } // start the agent on this pending item
  | { type: "run_gate"; itemId: string } // agent finished; verify the gate
  | { type: "advance"; itemId: string } // gate passed; mark done, move on
  | { type: "repair"; itemId: string } // gate failed; reprompt the same item
  | { type: "block"; itemId: string; reason: string } // exhausted retries
  | { type: "wait" } // agent still working; nothing to do this tick
  | { type: "complete" }; // every item terminal → checklist done

export interface DecideOptions {
  /** Max failed-gate reprompts before an item is blocked for a human. */
  maxAttempts?: number;
}

/**
 * The session workflowStatuses that mean the agent has finished its turn for an
 * item and the gate can now be evaluated. `awaiting_review` counts as finished:
 * the agent produced work and is handing off — it does not consume a slot and
 * must not block the checklist waiting for itself. `working` (and the pre-start
 * states) mean still in progress; `awaiting_input`/`blocked` are human-gated and
 * are handled by the driver as a hold, not as "finished".
 */
export function agentFinishedFromWorkflow(
  workflowStatus: string | null | undefined,
): boolean {
  return workflowStatus === "awaiting_review" || workflowStatus === "completed";
}

/**
 * Decide the single next action for a checklist. Pure. Walks strictly in
 * sortOrder: the "current" item is the first that is neither completed nor
 * cancelled, and no later item is ever acted on before it. The checklist is
 * complete only when every item is terminal.
 */
export function decideChecklistAction(
  items: readonly ChecklistItemState[],
  opts: DecideOptions = {},
): ChecklistAction {
  const maxAttempts = opts.maxAttempts ?? 3;
  const ordered = [...items].sort((a, b) => a.sortOrder - b.sortOrder);

  const current = ordered.find(
    (i) => i.status !== "completed" && i.status !== "cancelled",
  );
  if (!current) return { type: "complete" };

  // A pending item hasn't been started yet.
  if (current.status === "pending") {
    return { type: "dispatch", itemId: current.id };
  }

  // in_progress: the agent has been dispatched. Nothing to do until it finishes
  // its turn — the agent never advances itself; the server drives the gate.
  if (!current.agentFinished) return { type: "wait" };

  // Agent finished but the gate hasn't been evaluated for this attempt yet.
  if (current.gateOutcome == null) {
    return { type: "run_gate", itemId: current.id };
  }

  if (current.gateOutcome === "pass") {
    return { type: "advance", itemId: current.id };
  }

  // Gate failed: reprompt/repair the same item until the attempt cap, then block
  // it for a human rather than looping forever.
  if ((current.gateAttempts ?? 0) >= maxAttempts) {
    return {
      type: "block",
      itemId: current.id,
      reason: `gate failed after ${maxAttempts} attempts`,
    };
  }
  return { type: "repair", itemId: current.id };
}
