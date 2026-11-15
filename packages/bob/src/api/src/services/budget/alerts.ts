/**
 * BOB-76 Phase 7: budget alerts that push to the owner.
 *
 * - budget_projected_miss: at the pace it is actually being used, a
 *   subscription will reset with a large part of its week unspent.
 * - budget_reserve_breach: Bob has runs on a subscription whose usage is
 *   already into the reserve held back for interactive work.
 *
 * Deduplicated per owner, type and subscription for 12 hours.
 */
import { and, eq, gte } from "@bob/db";
import { db } from "@bob/db/client";
import { notifications, workspaceMembers } from "@bob/db/schema";
import type { AssembledAccount, BudgetStateWire, BudgetVerdict } from "@bob/ws";

export interface BudgetAlert {
  type: "budget_projected_miss" | "budget_reserve_breach";
  accountId: string;
  title: string;
  body: string;
}

const PROVIDER: Record<string, string> = { claude: "Claude", codex: "Codex", grok: "xAI", kimi: "Kimi" };
const MISS_MARGIN_PCT = 20;
const MISS_HORIZON_HOURS = 48;

/** Pure: which alerts the current state calls for. */
export function budgetAlerts(state: BudgetStateWire, verdict: BudgetVerdict, assembled: readonly AssembledAccount[]): BudgetAlert[] {
  const alerts: BudgetAlert[] = [];
  for (const a of assembled) {
    const v = verdict.accounts.find((x) => x.accountId === a.input.accountId);
    if (!v || !a.weekly || a.input.status !== "ready" || v.hoursToReset <= 0) continue;
    const name = `${PROVIDER[a.input.provider] ?? a.input.provider} ${a.label}`;
    const landingTarget = state.policy.accounts[a.input.accountId]?.landingPct ?? state.policy.landingPct;
    const atCurrentPace = Math.min(100, v.usedPercent + a.rates.burnPctPerHour * v.hoursToReset);
    if (v.hoursToReset <= MISS_HORIZON_HOURS && atCurrentPace < landingTarget - MISS_MARGIN_PCT) {
      const hours = Math.max(1, Math.round(v.hoursToReset));
      alerts.push({
        type: "budget_projected_miss",
        accountId: a.input.accountId,
        title: `${name} will reset with ~${Math.round(landingTarget - atCurrentPace)}% unused`,
        body: `At the current pace it lands near ${Math.round(atCurrentPace)}% when it resets in ${hours}h (target ${landingTarget}%). ${verdict.enforce ? "Boost to spend it faster." : "Turn on enforcement or boost in the Budget cockpit to put it to work."}`,
      });
    }
    if (v.activeBobRuns > 0 && v.usedPercent >= landingTarget - v.effectiveReservePct) {
      alerts.push({
        type: "budget_reserve_breach",
        accountId: a.input.accountId,
        title: `Bob is using your reserve on ${name}`,
        body: `${name} is at ${Math.round(v.usedPercent)}% with ${v.activeBobRuns} Bob run${v.activeBobRuns === 1 ? "" : "s"} on it; the last ${Math.round(v.effectiveReservePct)}% before the ${landingTarget}% target is held for you.${verdict.enforce ? "" : " In shadow mode the legacy pacing does not respect the reserve."}`,
      });
    }
  }
  return alerts;
}

/** Send new alerts to every workspace owner, at most once per 12 hours each. Best-effort. */
export async function sendBudgetAlerts(alerts: readonly BudgetAlert[], now = new Date()): Promise<number> {
  if (!alerts.length) return 0;
  const { createInAppNotification } = await import("../notifications/notificationService.js");
  const owners = [...new Set((await db.select({ userId: workspaceMembers.userId }).from(workspaceMembers).where(eq(workspaceMembers.role, "owner"))).map((r) => r.userId))];
  const since = new Date(now.getTime() - 12 * 3_600_000);
  let sent = 0;
  for (const userId of owners) {
    for (const alert of alerts) {
      try {
        const recent = await db
          .select({ id: notifications.id })
          .from(notifications)
          .where(and(eq(notifications.userId, userId), eq(notifications.type, alert.type), eq(notifications.title, alert.title), gte(notifications.createdAt, since.toISOString())))
          .limit(1);
        if (recent.length) continue;
        await createInAppNotification(db, { userId, type: alert.type, title: alert.title, body: alert.body, url: "/budget" });
        sent += 1;
      } catch (error) {
        console.warn(`[budget] alert ${alert.type} failed for ${userId}:`, error instanceof Error ? error.message : error);
      }
    }
  }
  return sent;
}
