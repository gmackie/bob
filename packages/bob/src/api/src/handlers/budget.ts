/**
 * BOB-76 budget cockpit API.
 *
 * `budget.state` returns the governor's read model, the server's own verdict
 * on it, and the recent decision log; the dashboard re-runs the same pure
 * governor locally for lever previews. `budget.setPolicy` replaces the policy
 * (normalized and clamped server-side, so a client cannot store an out-of-range
 * lever) and records who changed what. Owner-only, like the other cockpit
 * controls: these levers decide how a subscription is spent.
 */
import { readBudgetPolicy, readRecentBudgetDecisions, writeBudgetPolicy } from "@bob/db";
import { db } from "@bob/db/client";
import { normalizeBudgetPolicy  } from "@bob/ws";
import type {BudgetPolicy} from "@bob/ws";

import { evaluateBudget } from "../services/budget/state.js";
import { assertOwner, audit } from "./cockpitControls.js";

export interface BudgetCtx {
  userId: string;
}

export async function budgetState(ctx: BudgetCtx) {
  await assertOwner(ctx.userId);
  const now = new Date();
  const [evaluation, decisions, stored] = await Promise.all([evaluateBudget(now), readRecentBudgetDecisions(db, 96), readBudgetPolicy(db)]);
  return {
    state: evaluation.state,
    verdict: evaluation.verdict,
    decisions: decisions.map((d) => ({ ...d, decidedAt: d.decidedAt.toISOString() })),
    policyUpdatedAt: stored?.updatedAt.toISOString() ?? null,
    policyUpdatedBy: stored?.updatedBy ?? null,
  } as unknown as Record<string, unknown>;
}

/** Top-level keys whose change is worth naming in the audit trail. */
function changedKeys(before: BudgetPolicy, after: BudgetPolicy): string[] {
  return (Object.keys(after) as (keyof BudgetPolicy)[]).filter((key) => JSON.stringify(before[key]) !== JSON.stringify(after[key]));
}

export async function budgetSetPolicy(ctx: BudgetCtx, input: { policy: Record<string, unknown>; note?: string }) {
  await assertOwner(ctx.userId);
  const before = normalizeBudgetPolicy((await readBudgetPolicy(db))?.policy);
  const after = normalizeBudgetPolicy(input.policy);
  const changed = changedKeys(before, after);
  if (changed.length === 0) return after as unknown as Record<string, unknown>;
  await writeBudgetPolicy(db, {
    policy: after as unknown as Record<string, unknown>,
    changedBy: ctx.userId,
    ...(input.note ? { note: input.note } : {}),
  });
  await audit(ctx.userId, "set_budget_policy", null, { changed, ...(input.note ? { note: input.note } : {}) });
  return after as unknown as Record<string, unknown>;
}
