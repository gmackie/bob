/**
 * BOB-76 Phase 6: what work costs, what got done, and what the backlog will
 * absorb in the coming weeks. Pure.
 *
 * Units: a cost is "% of a week" on the subscription that served it, summed
 * across subscriptions (a run that spent 2% of Claude A's week and 1% of
 * Codex B's costs 3 points). Capacity uses the same points, so the planner can
 * fill a week with items.
 */
import { weightedTokens, type AccountRates } from "./budget-forecast";
import type { BudgetVerdict } from "./budget-governor";
import type { LedgerTokens } from "./budget-meters";
import type { AssembledAccount } from "./budget-state";

export interface WorkItemSpendInput {
  workItemId: string;
  projectId: string | null;
  title: string;
  status: string;
  updatedAt: string;
  byAccount: Array<{ authIndex: string; sessions: number; tokens: LedgerTokens }>;
}

export interface WorkItemCost {
  workItemId: string;
  projectId: string | null;
  title: string;
  status: string;
  updatedAt: string;
  sessions: number;
  tokens: LedgerTokens;
  /** Undefined when no serving account has a fitted %-per-token rate yet. */
  pctOfWeek?: number;
  estimated: boolean;
}

const zero = (): LedgerTokens => ({ input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheCreation: 0, total: 0 });
const add = (a: LedgerTokens, b: LedgerTokens): LedgerTokens => ({
  input: a.input + b.input,
  output: a.output + b.output,
  reasoning: a.reasoning + b.reasoning,
  cacheRead: a.cacheRead + b.cacheRead,
  cacheCreation: a.cacheCreation + b.cacheCreation,
  total: a.total + b.total,
});

export const DONE_STATUSES: ReadonlySet<string> = new Set(["done", "completed", "in_review", "review"]);

/** Rates by proxy auth index, from the assembled governor inputs. */
export function ratesByAuthIndex(assembled: readonly AssembledAccount[], authIndexOf: (accountId: string) => string | undefined): Map<string, AccountRates> {
  const out = new Map<string, AccountRates>();
  for (const a of assembled) {
    const authIndex = authIndexOf(a.input.accountId);
    if (authIndex) out.set(authIndex, a.rates);
  }
  return out;
}

export function costOfItems(items: readonly WorkItemSpendInput[], rates: ReadonlyMap<string, AccountRates>): WorkItemCost[] {
  return items.map((item) => {
    let tokens = zero();
    let sessions = 0;
    let pct = 0;
    let priced = false;
    let estimated = false;
    for (const part of item.byAccount) {
      tokens = add(tokens, part.tokens);
      sessions += part.sessions;
      const rate = rates.get(part.authIndex)?.pctPerWeightedToken;
      if (rate !== undefined) {
        pct += weightedTokens(part.tokens) * rate;
        priced = true;
      } else if (weightedTokens(part.tokens) > 0) {
        estimated = true;
      }
    }
    return {
      workItemId: item.workItemId,
      projectId: item.projectId,
      title: item.title,
      status: item.status,
      updatedAt: item.updatedAt,
      sessions,
      tokens,
      ...(priced ? { pctOfWeek: pct } : {}),
      estimated: estimated || !priced,
    };
  });
}

const median = (values: number[]): number | undefined => {
  if (!values.length) return undefined;
  const s = [...values].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1]! + s[m]!) / 2;
};

export interface ProjectThroughput {
  projectId: string | null;
  done: number;
  planned: number;
  costPct: number;
  medianItemPct?: number;
  tokens: number;
}

/**
 * Done this week vs planned for the rest of it, per project. `planned` comes
 * from the planner's first week so the two views can never disagree.
 */
export function throughputByProject(costs: readonly WorkItemCost[], weekStart: Date, plannedByProject: ReadonlyMap<string | null, number>): ProjectThroughput[] {
  const projects = new Map<string | null, ProjectThroughput & { pcts: number[] }>();
  const entry = (projectId: string | null) => {
    let p = projects.get(projectId);
    if (!p) {
      p = { projectId, done: 0, planned: plannedByProject.get(projectId) ?? 0, costPct: 0, tokens: 0, pcts: [] };
      projects.set(projectId, p);
    }
    return p;
  };
  for (const cost of costs) {
    const p = entry(cost.projectId);
    p.costPct += cost.pctOfWeek ?? 0;
    p.tokens += cost.tokens.total;
    if (DONE_STATUSES.has(cost.status) && Date.parse(cost.updatedAt) >= weekStart.getTime()) {
      p.done += 1;
      if (cost.pctOfWeek !== undefined) p.pcts.push(cost.pctOfWeek);
    }
  }
  for (const projectId of plannedByProject.keys()) entry(projectId);
  return [...projects.values()]
    .map(({ pcts, ...rest }) => {
      const m = median(pcts);
      return { ...rest, ...(m !== undefined ? { medianItemPct: m } : {}) };
    })
    .sort((a, b) => b.done + b.planned - (a.done + a.planned) || b.costPct - a.costPct);
}

/** A typical item's cost for a project: median of its finished items, else everyone's, else the fallback. */
export function estimateItemPct(projectId: string | null, costs: readonly WorkItemCost[], fallbackPct: number): { pct: number; basis: "project" | "global" | "fallback"; samples: number } {
  const finished = costs.filter((c) => DONE_STATUSES.has(c.status) && c.pctOfWeek !== undefined);
  const own = finished.filter((c) => c.projectId === projectId).map((c) => c.pctOfWeek!);
  if (own.length >= 3) return { pct: median(own)!, basis: "project", samples: own.length };
  const all = finished.map((c) => c.pctOfWeek!);
  if (all.length >= 3) return { pct: median(all)!, basis: "global", samples: all.length };
  return { pct: fallbackPct, basis: "fallback", samples: 0 };
}

/**
 * Capacity in points: this week what is still spendable before reset; later
 * weeks a full week per ready, metered subscription after reserve and your
 * forecast use.
 */
export function weeklyCapacityPct(verdict: BudgetVerdict, assembled: readonly AssembledAccount[], landingPct: number, reservePct: number, weeks = 5): number[] {
  const thisWeek = verdict.accounts.reduce((sum, a) => sum + a.spendablePct, 0);
  const fullWeek = assembled
    .filter((a) => a.input.status === "ready" && a.weekly)
    .reduce((sum, a) => sum + Math.max(0, landingPct - reservePct - a.input.interactivePctPerHour * 168), 0);
  return Array.from({ length: weeks }, (_, i) => (i === 0 ? thisWeek : fullWeek));
}

export interface BacklogItem {
  workItemId: string;
  projectId: string | null;
  title: string;
  identifier?: string;
  status: string;
}

export interface PlannedItem extends BacklogItem {
  estPct: number;
  basis: "project" | "global" | "fallback";
}

export interface PlannedWeek {
  index: number;
  capacityPct: number;
  usedPct: number;
  items: PlannedItem[];
  byProject: Record<string, number>;
}

export interface WeekPlan {
  weeks: PlannedWeek[];
  overflow: number;
  /** How many weeks of capacity the backlog fills (≥ weeks.length means it runs past the horizon). */
  depthWeeks: number;
}

/**
 * Fill weeks in backlog order (the caller sorts by priority and project
 * weight). An item goes in the first week with room; an item bigger than a
 * whole week still takes one week so it is not lost.
 */
export function planWeeks(backlog: readonly BacklogItem[], capacity: readonly number[], costs: readonly WorkItemCost[], fallbackPct: number): WeekPlan {
  const weeks: PlannedWeek[] = capacity.map((capacityPct, index) => ({ index, capacityPct, usedPct: 0, items: [], byProject: {} }));
  let overflow = 0;
  for (const item of backlog) {
    const estimate = estimateItemPct(item.projectId, costs, fallbackPct);
    const week = weeks.find((w) => w.capacityPct - w.usedPct >= estimate.pct) ?? weeks.find((w) => w.items.length === 0 && w.capacityPct > 0);
    if (!week) {
      overflow += 1;
      continue;
    }
    week.usedPct += estimate.pct;
    week.items.push({ ...item, estPct: estimate.pct, basis: estimate.basis });
    const key = item.projectId ?? "none";
    week.byProject[key] = (week.byProject[key] ?? 0) + 1;
  }
  const totalDemand = weeks.reduce((s, w) => s + w.usedPct, 0) + overflow * fallbackPct;
  let depthWeeks = 0;
  let remaining = totalDemand;
  for (const w of weeks) {
    if (remaining <= 0) break;
    if (w.capacityPct <= 0) continue;
    depthWeeks += Math.min(1, remaining / w.capacityPct);
    remaining -= w.capacityPct;
  }
  if (remaining > 0 && weeks.at(-1)?.capacityPct) depthWeeks += remaining / weeks.at(-1)!.capacityPct;
  return { weeks, overflow, depthWeeks };
}

/** A one-line cost report for the tracker when an item finishes. */
export function costSummary(cost: WorkItemCost): string {
  const tokens = cost.tokens.total >= 1_000_000 ? `${(cost.tokens.total / 1_000_000).toFixed(1)}M` : `${Math.round(cost.tokens.total / 1000)}k`;
  const pct = cost.pctOfWeek !== undefined ? `${cost.pctOfWeek.toFixed(2)}% of a subscription week` : "cost in % not yet calibrated";
  return `Budget: ${tokens} tokens across ${cost.sessions} run${cost.sessions === 1 ? "" : "s"} · ${pct}${cost.estimated ? " (partly estimated)" : ""}.`;
}
