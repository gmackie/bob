/**
 * Mobile Home glance for the subscription budget (BOB-76): one line per
 * subscription and the dispatch mode, from the same governor the server runs.
 */
import { effectiveMode, governState, type BudgetMode, type BudgetStateWire } from "@bob/ws";

export type GlanceTone = "ok" | "attention" | "down" | "idle";

export interface GlanceRow {
  accountId: string;
  title: string;
  usedPct: number;
  /** Where the week lands if the plan holds (used + your forecast + Bob's plan). */
  landingPct: number;
  detail: string;
  tone: GlanceTone;
}

export interface BudgetGlance {
  headline: string;
  mode: BudgetMode;
  modeUntil?: string;
  enforce: boolean;
  rows: GlanceRow[];
  needsYou: string[];
}

const PROVIDER: Record<string, string> = { claude: "Claude", codex: "Codex", grok: "xAI", kimi: "Kimi" };

function hoursLabel(ms: number): string {
  const h = ms / 3_600_000;
  return h >= 48 ? `${Math.round(h / 24)}d` : `${Math.max(0, Math.round(h))}h`;
}

export function buildBudgetGlance(state: BudgetStateWire, now: Date): BudgetGlance {
  const { verdict, assembled } = governState(state, now);
  const rows: GlanceRow[] = assembled.map((a) => {
    const v = verdict.accounts.find((x) => x.accountId === a.input.accountId);
    const title = `${PROVIDER[a.input.provider] ?? a.input.provider} · ${a.label}`;
    if (a.input.status !== "ready") {
      return { accountId: a.input.accountId, title, usedPct: 0, landingPct: 0, detail: a.detail ?? a.input.status, tone: "down" };
    }
    if (!a.weekly || !v) {
      return { accountId: a.input.accountId, title, usedPct: 0, landingPct: 0, detail: "no meter", tone: "idle" };
    }
    const reset = a.weekly.resetsAt ? Date.parse(a.weekly.resetsAt) - now.getTime() : Number.NaN;
    const landing = Math.min(100, v.projectedLandingPct);
    return {
      accountId: a.input.accountId,
      title,
      usedPct: v.usedPercent,
      landingPct: landing,
      detail: `${Math.round(v.usedPercent)}% used · lands ${Math.round(landing)}%${Number.isFinite(reset) ? ` · resets in ${hoursLabel(reset)}` : ""}`,
      tone: v.slots > 0 || v.activeBobRuns > 0 ? "ok" : v.spendablePct > 0 ? "attention" : "idle",
    };
  });
  const mode = effectiveMode(state.policy, now);
  return {
    headline:
      mode === "pause"
        ? "Paused — Bob is not starting new runs"
        : `${verdict.totalSlots} run${verdict.totalSlots === 1 ? "" : "s"} cleared to start${verdict.enforce ? "" : " (shadow)"}`,
    mode,
    ...(mode !== "run" && state.policy.modeUntil ? { modeUntil: state.policy.modeUntil } : {}),
    enforce: verdict.enforce,
    rows,
    needsYou: rows.filter((r) => r.tone === "down").map((r) => `${r.title}: ${r.detail}`),
  };
}
