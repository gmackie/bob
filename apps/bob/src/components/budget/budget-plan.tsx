"use client";

import { cn } from "@gmacko/core/ui";
import type { PlannedWeek, ProjectThroughput, WorkItemCost } from "@bob/ws";

export interface ThroughputResponse {
  at: string;
  weekStart: string;
  projects: Record<string, { name: string; key: string | null }>;
  throughput: ProjectThroughput[];
  costs: WorkItemCost[];
  plan: { weeks: Array<PlannedWeek & { itemCount: number }>; overflow: number; depthWeeks: number };
  capacity: number[];
  fallbackPct: number;
}

const pct = (n: number | undefined, digits = 1) => (n === undefined ? "—" : `${n.toFixed(digits)}%`);
const tokens = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${Math.round(n / 1000)}k` : `${n}`);

function projectName(data: ThroughputResponse, projectId: string | null): string {
  if (!projectId) return "No project";
  return data.projects[projectId]?.name ?? projectId.slice(0, 8);
}

export function ThroughputPanel({ data }: { data: ThroughputResponse }) {
  const rows = data.throughput.slice(0, 10);
  const max = Math.max(1, ...rows.map((r) => r.done + r.planned));
  return (
    <section aria-labelledby="throughput-title" className="rounded-2xl border border-border bg-card p-4 shadow-sm">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="throughput-title" className="font-display text-base font-semibold">
          Throughput
        </h2>
        <span className="text-xs text-muted-foreground">last 7 days done · planned for the rest of this week</span>
      </div>
      {rows.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">No costed work yet. Item costs appear once runs report their sessions.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[520px] text-[12.5px]">
            <thead>
              <tr className="text-left text-[11px] tracking-wide text-muted-foreground uppercase">
                <th className="py-1.5 pr-3 font-medium">Project</th>
                <th className="py-1.5 pr-3 font-medium">Done / planned</th>
                <th className="py-1.5 pr-3 text-right font-medium">Cost</th>
                <th className="py-1.5 pr-3 text-right font-medium">Median / item</th>
                <th className="py-1.5 text-right font-medium">Tokens</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.projectId ?? "none"} className="border-t border-border">
                  <td className="py-2 pr-3 font-medium">{projectName(data, row.projectId)}</td>
                  <td className="py-2 pr-3">
                    <div className="flex items-center gap-2">
                      <div className="flex h-2 w-40 overflow-hidden rounded-full bg-muted" role="img" aria-label={`${row.done} done, ${row.planned} planned`}>
                        <span className="h-full bg-foreground/75" style={{ width: `${(row.done / max) * 100}%` }} />
                        <span className="h-full bg-primary/60" style={{ width: `${(row.planned / max) * 100}%` }} />
                      </div>
                      <span className="font-mono tabular-nums">
                        {row.done}
                        <span className="text-muted-foreground"> / {row.done + row.planned}</span>
                      </span>
                    </div>
                  </td>
                  <td className="py-2 pr-3 text-right font-mono tabular-nums">{pct(row.costPct)}</td>
                  <td className="py-2 pr-3 text-right font-mono tabular-nums">{pct(row.medianItemPct, 2)}</td>
                  <td className="py-2 text-right font-mono text-muted-foreground tabular-nums">{tokens(row.tokens)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {data.costs.length ? (
        <details className="mt-3">
          <summary className="cursor-pointer text-[12px] text-muted-foreground hover:text-foreground">Recent item costs ({data.costs.length})</summary>
          <ul className="mt-2 max-h-64 space-y-1 overflow-y-auto pr-1 text-[12px]">
            {data.costs.slice(0, 40).map((c) => (
              <li key={c.workItemId} className="flex items-baseline justify-between gap-3">
                <span className="min-w-0 truncate">
                  <span className="text-muted-foreground">{projectName(data, c.projectId)} · </span>
                  {c.title}
                </span>
                <span className="shrink-0 font-mono tabular-nums">
                  {pct(c.pctOfWeek, 2)}
                  {c.estimated ? <span className="ml-1 text-muted-foreground">est.</span> : null}
                  <span className="ml-2 text-muted-foreground">{tokens(c.tokens.total)}</span>
                </span>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </section>
  );
}

const WEEK_LABEL = ["This week", "Next week", "Week +2", "Week +3", "Week +4"];

export function PlannerPanel({ data }: { data: ThroughputResponse }) {
  const depth = data.plan.depthWeeks;
  const depthTone = depth < 1 ? "text-destructive" : depth < 2 ? "text-primary" : "text-foreground";
  return (
    <section aria-labelledby="planner-title" className="rounded-2xl border border-border bg-card p-4 shadow-sm">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="planner-title" className="font-display text-base font-semibold">
          Capacity planner
        </h2>
        <span className="text-xs text-muted-foreground">
          backlog depth <span className={cn("font-mono font-semibold", depthTone)}>{depth.toFixed(1)} weeks</span>
          {depth < 1 ? " · surplus will flow to grooming and discovery" : ""}
        </span>
      </div>
      <div className="grid grid-cols-[repeat(5,minmax(150px,1fr))] gap-2 overflow-x-auto pb-1">
        {data.plan.weeks.map((week) => {
          const fill = week.capacityPct > 0 ? Math.min(100, (week.usedPct / week.capacityPct) * 100) : 0;
          return (
            <div key={week.index} className="flex min-h-[220px] flex-col rounded-xl border border-border bg-background/60 p-2.5">
              <div className="flex items-baseline justify-between">
                <span className="text-[12px] font-semibold">{WEEK_LABEL[week.index] ?? `Week +${week.index}`}</span>
                <span className="font-mono text-[11px] text-muted-foreground">{week.itemCount} items</span>
              </div>
              <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted" role="img" aria-label={`${Math.round(fill)}% of capacity planned`}>
                <div className="h-full rounded-full bg-primary" style={{ width: `${fill}%` }} />
              </div>
              <div className="mt-1 font-mono text-[10.5px] text-muted-foreground">
                {week.usedPct.toFixed(0)} / {week.capacityPct.toFixed(0)} pts
              </div>
              <ul className="mt-2 max-h-[360px] flex-1 space-y-1 overflow-y-auto text-[11.5px]">
                {week.items.slice(0, 12).map((item) => (
                  <li key={item.workItemId} className="rounded-md border border-border bg-card px-1.5 py-1" title={`${item.title} · est. ${item.estPct.toFixed(2)}% (${item.basis})`}>
                    <div className="truncate">{item.title}</div>
                    <div className="flex justify-between font-mono text-[10px] text-muted-foreground">
                      <span className="truncate">{projectName(data, item.projectId)}</span>
                      <span>
                        {item.estPct.toFixed(1)}
                        {item.basis === "fallback" ? "?" : ""}
                      </span>
                    </div>
                  </li>
                ))}
                {week.itemCount > 12 ? <li className="text-center text-[11px] text-muted-foreground">+{week.itemCount - 12} more</li> : null}
              </ul>
            </div>
          );
        })}
      </div>
      {data.plan.overflow ? <p className="mt-2 text-[12px] text-muted-foreground">{data.plan.overflow} more items beyond the 5-week horizon.</p> : null}
      <p className="mt-2 text-[11px] text-muted-foreground">
        Estimates come from finished items in the same project (else all projects; “?” = default {data.fallbackPct.toFixed(1)} pts until enough history).
      </p>
    </section>
  );
}
