// Re-exports for the buddy-tools middleware layer (Task 5.4).
//
// Composition order (outer → inner): logging → budget → handler.
// That way the log row captures BUDGET_EXHAUSTED errors too, and the
// wall-clock deduction in `withBudget` measures only the underlying
// handler's time, not the log INSERT/UPDATE round-trips.

import type { ToolHandler } from "../handler";
import type { ToolName } from "../schemas";

import { withBudget } from "./budget";
import type { BudgetCost, BudgetState } from "./budget";
import { withLogging } from "./logging";

export {
  withBudget,
  type BudgetState,
  type BudgetCost,
} from "./budget";

export { withLogging, summarize } from "./logging";

export interface WithMiddlewareOptions {
  /** Shared budget state for the runner session. Required. */
  budget: BudgetState;
  /** Per-call cost hints (tokens / s2 requests). Optional. */
  cost?: BudgetCost;
  /** Whether to wrap with the tool_call_log middleware. Default: true. */
  logging?: boolean;
}

/**
 * Convenience: wrap `handler` with both budget enforcement and
 * tool_call_log bookkeeping in the correct order.
 */
export function withMiddleware<T extends ToolName>(
  toolName: T,
  handler: ToolHandler<T>,
  opts: WithMiddlewareOptions,
): ToolHandler<T> {
  const budgetWrapped = withBudget(handler, opts.budget, opts.cost);
  if (opts.logging === false) {
    return budgetWrapped;
  }
  return withLogging(toolName, budgetWrapped);
}
