/**
 * BOB-76 Phase 6: cost per work item, throughput per project, the 4-week
 * capacity plan, and the one-time cost report on finished Kanbanger issues.
 */
import { and, asc, eq, inArray, readWorkItemCostRows, sql } from "@bob/db";
import type { WorkItemCostRow } from "@bob/db";
import { db } from "@bob/db/client";
import { projects, workItems } from "@bob/db/schema";
import {
  costOfItems,
  costSummary,
  DONE_STATUSES,
  governState,
  planWeeks,
  ratesByAuthIndex,
  throughputByProject,
  weeklyCapacityPct,
} from "@bob/ws";
import type { BacklogItem, WorkItemCost, WorkItemSpendInput } from "@bob/ws";

import { mirrorWorkItemEvent } from "../tracker/trackerMirror.js";
import { loadBudgetState } from "./state.js";

const DAY_MS = 86_400_000;
const PLAN_STATUSES = ["ready", "todo", "backlog"];

/** Pure: cost rows (one per item × account) → per-item spend inputs. */
export function groupCostRows(rows: readonly WorkItemCostRow[]): WorkItemSpendInput[] {
  const byItem = new Map<string, WorkItemSpendInput>();
  for (const row of rows) {
    let item = byItem.get(row.workItemId);
    if (!item) {
      item = { workItemId: row.workItemId, projectId: row.projectId, title: row.title, status: row.status, updatedAt: row.updatedAt.toISOString(), byAccount: [] };
      byItem.set(row.workItemId, item);
    }
    item.byAccount.push({
      authIndex: row.authIndex,
      sessions: row.sessions,
      tokens: {
        input: row.inputTokens,
        output: row.outputTokens,
        reasoning: row.reasoningTokens,
        cacheRead: row.cacheReadTokens,
        cacheCreation: row.cacheCreationTokens,
        total: row.totalTokens,
      },
    });
  }
  return [...byItem.values()];
}

async function itemCosts(now: Date, lookbackDays: number) {
  const state = await loadBudgetState(now);
  const { verdict, assembled } = governState(state, now);
  const authIndexOf = (accountId: string) => state.accounts.find((a) => a.accountId === accountId)?.authIndex;
  const rows = await readWorkItemCostRows(db, { since: new Date(now.getTime() - lookbackDays * DAY_MS) });
  const costs = costOfItems(groupCostRows(rows), ratesByAuthIndex(assembled, authIndexOf));
  return { state, verdict, assembled, costs };
}

export async function budgetThroughput(now = new Date()) {
  const { state, verdict, assembled, costs } = await itemCosts(now, 28);
  const backlogRows = await db
    .select({ id: workItems.id, projectId: workItems.projectId, title: workItems.title, status: workItems.status, identifier: workItems.externalId })
    .from(workItems)
    .where(and(inArray(workItems.status, PLAN_STATUSES), eq(workItems.kind, "task")))
    .orderBy(sql`case ${workItems.status} when 'ready' then 0 when 'todo' then 1 else 2 end`, asc(workItems.queueSortOrder), asc(workItems.createdAt))
    .limit(400);
  const weights = state.policy.projectWeights;
  // Project weight nudges order without starving anyone: a weight-2 project's
  // items sort as if they were half as far down the queue.
  const backlog: BacklogItem[] = backlogRows
    .map((row, index) => ({ row, rank: index / Math.max(0.1, weights[row.projectId ?? ""] ?? 1) }))
    .sort((a, b) => a.rank - b.rank)
    .map(({ row }) => ({ workItemId: row.id, projectId: row.projectId, title: row.title, status: row.status, ...(row.identifier ? { identifier: row.identifier } : {}) }));
  const capacity = weeklyCapacityPct(verdict, assembled, state.policy.landingPct, state.policy.reservePct, 5);
  const ready = assembled.filter((a) => a.input.status === "ready" && a.weekly);
  const fallbackPct = ready.length ? ready.reduce((s, a) => s + a.rates.costPerRunPct, 0) / ready.length : 1;
  const plan = planWeeks(backlog, capacity, costs, fallbackPct);
  const weekStart = new Date(now.getTime() - 7 * DAY_MS);
  const recent = costs.filter((c) => Date.parse(c.updatedAt) >= weekStart.getTime());
  const plannedByProject = new Map<string | null, number>(
    Object.entries(plan.weeks[0]?.byProject ?? {}).map(([key, n]) => [key === "none" ? null : key, n]),
  );
  const throughput = throughputByProject(recent, weekStart, plannedByProject);
  const projectIds = [...new Set([...throughput.map((t) => t.projectId), ...backlog.map((b) => b.projectId)].filter((id): id is string => Boolean(id)))];
  const names = projectIds.length
    ? await db.select({ id: projects.id, name: projects.name, key: projects.key }).from(projects).where(inArray(projects.id, projectIds))
    : [];
  return {
    at: now.toISOString(),
    weekStart: weekStart.toISOString(),
    projects: Object.fromEntries(names.map((p) => [p.id, { name: p.name, key: p.key }])),
    throughput,
    costs: [...costs].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 100),
    plan: { ...plan, weeks: plan.weeks.map((w) => ({ ...w, items: w.items.slice(0, 40), itemCount: w.items.length })) },
    capacity,
    fallbackPct,
  };
}

/**
 * Post each finished Kanbanger item's cost to its issue once. Best-effort and
 * bounded per tick; the marker in source metadata prevents repeats.
 */
export async function reportFinishedItemCosts(now = new Date(), limit = 5): Promise<number> {
  const { costs } = await itemCosts(now, 7);
  const finished: WorkItemCost[] = costs.filter((c) => DONE_STATUSES.has(c.status) && c.status !== "in_review" && c.status !== "review");
  if (!finished.length) return 0;
  const rows = await db
    .select({ id: workItems.id, sourceMetadata: workItems.sourceMetadata })
    .from(workItems)
    .where(inArray(workItems.id, finished.map((c) => c.workItemId)));
  const reported = new Set(rows.filter((r) => r.sourceMetadata.budgetCostReportedAt).map((r) => r.id));
  let posted = 0;
  for (const cost of finished) {
    if (posted >= limit) break;
    if (reported.has(cost.workItemId)) continue;
    const meta = rows.find((r) => r.id === cost.workItemId)?.sourceMetadata ?? {};
    await db
      .update(workItems)
      .set({ sourceMetadata: { ...meta, budgetCostReportedAt: now.toISOString(), budgetCost: { tokens: cost.tokens.total, pctOfWeek: cost.pctOfWeek ?? null, sessions: cost.sessions } } })
      .where(eq(workItems.id, cost.workItemId));
    await mirrorWorkItemEvent(db, cost.workItemId, { kind: "cost", summary: costSummary(cost) }).catch(() => undefined);
    posted += 1;
  }
  return posted;
}
