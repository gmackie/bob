/**
 * Mapping between Stripe prices/products and tenant plans.
 *
 * Price IDs are deployment-specific, so they come from env rather than being
 * hard-coded:
 *
 *   STRIPE_PRICE_PREMIUM=price_...
 *   STRIPE_PRICE_PRO=price_...
 *
 * The mapping is resolved lazily on each call so tests (and runtime config
 * reloads) can vary the env without reimporting the module.
 */
import type { TenantPlan } from "./entitlements.js";

/** Paid plans that can be purchased. `free` is never a Stripe price. */
export type PaidPlan = Exclude<TenantPlan, "free">;

const PAID_PLAN_ENV: Record<PaidPlan, string> = {
  premium: "STRIPE_PRICE_PREMIUM",
  pro: "STRIPE_PRICE_PRO",
};

/** priceId -> plan, built from env. Prices left unset are simply omitted. */
export function priceToPlanMap(): Map<string, PaidPlan> {
  const map = new Map<string, PaidPlan>();
  for (const [plan, envVar] of Object.entries(PAID_PLAN_ENV) as [
    PaidPlan,
    string,
  ][]) {
    const priceId = process.env[envVar]?.trim();
    if (priceId) map.set(priceId, plan);
  }
  return map;
}

/** Resolve a Stripe price ID to a plan, or `null` when it isn't configured. */
export function planForPriceId(priceId: string): PaidPlan | null {
  return priceToPlanMap().get(priceId) ?? null;
}

/** Resolve the Stripe price ID configured for a paid plan, or `null`. */
export function priceIdForPlan(plan: PaidPlan): string | null {
  const priceId = process.env[PAID_PLAN_ENV[plan]]?.trim();
  return priceId == null || priceId === "" ? null : priceId;
}

/** Paid plans that currently have a Stripe price configured. */
export function purchasablePlans(): PaidPlan[] {
  return (Object.keys(PAID_PLAN_ENV) as PaidPlan[]).filter(
    (plan) => priceIdForPlan(plan) !== null,
  );
}
