"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";

import { useTRPC } from "~/trpc/react";
import {
  buildPendingApprovalRows,
  type PendingApprovalSessionLike,
} from "./pending-approval-model";

// The "needs you" surface. Sessions parked in `blocked` are waiting on a human
// yes/no at a permission gate; each one holds a runner slot until answered, so
// they are the most time-sensitive thing on the page and get top billing.
//
// Data comes from tRPC session.list (full rows, status field intact) rather than
// the Effect-RPC agent.run.list — a blocked *session* still has a *running*
// agent_run, so run status can't distinguish "needs you" from "healthy".
export function PendingApproval({ workspaceId }: { workspaceId?: string | null }) {
  const trpc = useTRPC();

  const { data } = useQuery(
    trpc.session.list.queryOptions(
      { status: "blocked", limit: 20 },
      { refetchInterval: 10_000 },
    ),
  );

  // session.list is PAGINATED: it returns { items, nextCursor }, NOT a bare
  // array. Reading it as an array made buildPendingApprovalRows call
  // `.filter` on the object and threw, which — with no error boundary around
  // MissionControl — unmounted the entire /tasks page (blank screen).
  const rows = buildPendingApprovalRows({
    sessions: (data?.items ?? []) as PendingApprovalSessionLike[],
    workspaceId,
  });

  // Nothing waiting → render nothing. This section only exists to shout when
  // there IS something; an always-present "0 pending" card would just be noise.
  if (rows.length === 0) return null;

  return (
    <section className="rounded-2xl border border-amber-500/40 bg-amber-500/[0.06] p-5 shadow-[0_0_0_1px_rgba(245,158,11,0.10)]">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="relative flex size-2.5">
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-amber-500/60" />
            <span className="relative inline-flex size-2.5 rounded-full bg-amber-500" />
          </span>
          <h2 className="font-display text-base font-semibold text-foreground">
            Pending your approval
          </h2>
        </div>
        <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-xs font-semibold tabular-nums text-amber-600 dark:text-amber-400">
          {rows.length}
        </span>
      </div>

      <p className="mt-1 text-xs text-muted-foreground">
        {rows.length === 1
          ? "A run is paused waiting for your yes/no. It holds a slot until you answer."
          : `${rows.length} runs are paused waiting for your yes/no. Each holds a slot until answered.`}
      </p>

      <div className="mt-4 flex flex-col gap-2">
        {rows.map((row) => (
          <Link
            key={row.id}
            href={row.href}
            className="flex items-center gap-3 rounded-xl border border-amber-500/25 bg-card/60 px-3 py-2.5 transition-colors hover:border-amber-500/50 hover:bg-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/40"
          >
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-foreground">
                {row.title}
              </p>
              <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <span
                  className="rounded-full bg-muted px-1.5 py-0.5 font-semibold"
                  translate="no"
                >
                  {row.agentLabel}
                </span>
                <span>{row.waitingLabel}</span>
              </div>
            </div>
            <span className="shrink-0 rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-semibold text-amber-950 transition-colors group-hover:bg-amber-400">
              Review &amp; approve →
            </span>
          </Link>
        ))}
      </div>
    </section>
  );
}
