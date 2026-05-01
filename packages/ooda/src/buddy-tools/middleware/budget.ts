// Per-runner-session budget enforcement for buddy tools.
//
// A single `BudgetState` is threaded across every tool call the agent
// makes in one runner session. Each wrapped call decrements the shared
// buckets before the underlying handler runs; if any bucket is already
// depleted the call short-circuits with a `BUDGET_EXHAUSTED` error and
// the handler never runs.
//
// Defaults mirror the design doc (§Budgeting): budget_papers=60,
// budget_seconds=180, max_s2_requests=200. Tokens have no default here
// because the agent-side token counter is owned by the runner, not by
// the tool dispatcher — callers pass in whatever their runner settings
// prescribe.

import { ToolHandlerError } from "../handler";
import type { ToolHandler } from "../handler";
import type { ToolName } from "../schemas";

/**
 * Mutable budget buckets shared across all tool calls in one runner
 * session. The wrapper decrements in place — do not copy the state
 * per-call or the budget will never actually shrink.
 */
export interface BudgetState {
  /** Agent-side token allowance. Not decremented here (runner-owned). */
  tokens: number;
  /** Wall-clock millisecond allowance across all tool calls. */
  wallClockMs: number;
  /** S2 request allowance. See note on `s2RequestCost` below. */
  s2Requests: number;
}

/**
 * Per-call cost hints. Tokens default to 0 because the runner updates
 * `tokens` itself after each agent turn; the tool dispatcher has no
 * visibility into token consumption.
 *
 * `s2RequestCost` is a passthrough today — handlers don't know they're
 * ultimately calling S2, so the counter is only decremented here when
 * the caller explicitly attributes a cost. Future work: push S2 cost
 * accounting into the research-backend and surface it back through the
 * handler result, then wire that into `withBudget` via the handler.
 */
export interface BudgetCost {
  tokens?: number;
  s2Requests?: number;
}

const DEFAULT_COST: Required<BudgetCost> = {
  tokens: 0,
  s2Requests: 0,
};

/**
 * Wrap a ToolHandler with shared-budget enforcement.
 *
 * Pre-call: if any bucket is <= 0, throw `ToolHandlerError("BUDGET_EXHAUSTED")`
 * without invoking `handler`. The dispatcher (Task 5.5) catches that and
 * wraps it in the ToolResult envelope — keeping the short-circuit on the
 * same rails as other structured tool errors.
 *
 * Post-call: deduct elapsed wall-clock ms from the bucket. The bucket
 * may go negative on a long call; we only check before, not during, so
 * one slow tool won't be mid-flight cancelled. Subsequent calls see the
 * negative balance and short-circuit.
 */
export function withBudget<T extends ToolName>(
  handler: ToolHandler<T>,
  budget: BudgetState,
  cost: BudgetCost = DEFAULT_COST,
): ToolHandler<T> {
  return async (args, ctx) => {
    if (budget.tokens <= 0) {
      throw new ToolHandlerError(
        "BUDGET_EXHAUSTED",
        "token budget exhausted for this runner session",
        { retryable: false },
      );
    }
    if (budget.wallClockMs <= 0) {
      throw new ToolHandlerError(
        "BUDGET_EXHAUSTED",
        "wall-clock budget exhausted for this runner session",
        { retryable: false },
      );
    }
    if (budget.s2Requests <= 0) {
      throw new ToolHandlerError(
        "BUDGET_EXHAUSTED",
        "s2 request budget exhausted for this runner session",
        { retryable: false },
      );
    }

    budget.tokens -= cost.tokens ?? 0;
    budget.s2Requests -= cost.s2Requests ?? 0;

    const startedAt = Date.now();
    try {
      return await handler(args, ctx);
    } finally {
      budget.wallClockMs -= Date.now() - startedAt;
    }
  };
}
