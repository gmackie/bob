"use client";

import { useQuery } from "@tanstack/react-query";

import { useTRPC } from "~/trpc/react";

type DiveStatus = "queued" | "running" | "done";

// `research.divesRecent` is `.output(z.any())` for OpenAPI, which degenerates
// the client query type; describe the projected dive row the UI consumes.
interface RecentDive {
  id: string;
  threadId: string | null;
  seed: string[];
  status: string;
  budgetPapers: number;
  budgetSeconds: number | null;
  elapsedMs: number | null;
}

const STATUS_COLOR: Record<DiveStatus, string> = {
  queued: "#8A8580",
  running: "#D4A04A",
  done: "#4A9D6B",
};

function formatElapsed(ms: number | null): string {
  if (ms === null) return "—";
  const secs = Math.max(0, Math.round(ms / 1000));
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  const rem = secs % 60;
  return rem === 0 ? `${mins}m` : `${mins}m${rem}s`;
}

export function ActiveDives() {
  const trpc = useTRPC();
  const divesQuery = useQuery(
    trpc.research.divesRecent.queryOptions({}),
  );

  if (divesQuery.isLoading) {
    return <div className="text-xs text-[#5A5855]">Loading dives…</div>;
  }
  if (divesQuery.isError) {
    return <div className="text-xs text-red-400">Failed to load dives.</div>;
  }
  const items =
    (divesQuery.data as unknown as { items: RecentDive[] } | undefined)?.items ??
    [];
  if (items.length === 0) {
    return <div className="text-xs text-[#5A5855]">No recent dives.</div>;
  }

  return (
    <div className="space-y-2">
      {items.map((dive) => {
        const status = dive.status as DiveStatus;
        const color = STATUS_COLOR[status] ?? "#8A8580";
        const seedPreview = dive.seed.slice(0, 2).join(", ");
        const extraSeeds =
          dive.seed.length > 2 ? ` +${dive.seed.length - 2}` : "";
        const budgetSecs = dive.budgetSeconds ?? 0;
        const pctSeconds =
          budgetSecs > 0 && dive.elapsedMs !== null
            ? Math.min(100, Math.round((dive.elapsedMs / 1000 / budgetSecs) * 100))
            : null;
        return (
          <div
            key={dive.id}
            className="rounded-[4px] border border-[#2A2A2F] bg-[#111113] p-3"
          >
            <div className="mb-1.5 flex items-center justify-between gap-2">
              <div className="flex min-w-0 items-center gap-2">
                <span
                  aria-hidden
                  className="h-2 w-2 shrink-0 rounded-full"
                  style={{ backgroundColor: color }}
                />
                <div className="truncate font-mono text-[11px] text-[#E8E4DF]">
                  {seedPreview}
                  {extraSeeds}
                </div>
              </div>
              <span
                className="shrink-0 font-mono text-[10px] uppercase tracking-wider"
                style={{ color }}
              >
                {dive.status}
              </span>
            </div>
            <div className="flex items-center gap-3 font-mono text-[10px] text-[#5A5855]">
              <span>elapsed {formatElapsed(dive.elapsedMs)}</span>
              <span>
                budget {dive.budgetPapers} papers / {budgetSecs}s
              </span>
              {pctSeconds !== null && <span>{pctSeconds}%</span>}
            </div>
          </div>
        );
      })}
    </div>
  );
}
