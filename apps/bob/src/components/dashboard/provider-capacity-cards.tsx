"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";

import { cn } from "@gmacko/core/ui";

import { useTRPC } from "~/trpc/react";
import {
  buildProviderCapacitySummaries,
  extractProviderCapacitySnapshotsFromRuns,
  getProviderCapacityHref,
  getProviderCapacityStatusLine,
  type DashboardTone,
  type ProviderCapacityRunSummary,
  type ProviderCapacitySummary,
  type ProviderSessionSummary,
  type WorkPipelineItem,
} from "./work-pipeline-model";

interface ProviderCapacityCardsProps {
  workspaceId?: string;
}

const TONE_CLASS: Record<DashboardTone, string> = {
  default: "bg-muted-foreground",
  warning: "bg-amber-500",
  danger: "bg-rose-500",
  success: "bg-emerald-500",
};

function ProviderCard({
  card,
  workspaceId,
}: {
  card: ProviderCapacitySummary;
  workspaceId?: string | null;
}) {
  return (
    <Link
      href={getProviderCapacityHref(card.provider, workspaceId)}
      className="rounded-2xl border border-border bg-card p-5 transition-colors hover:bg-muted/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
    >
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-display text-base font-semibold text-foreground">
          {card.label}
        </h2>
        <span
          className={cn("size-2 rounded-full", TONE_CLASS[card.tone])}
          aria-hidden="true"
        />
      </div>
      <div className="mt-5 space-y-4">
        {card.usageLimits.map((limit) => {
          const barPercent = limit.barPercent ?? limit.remainingPercent ?? 0;
          const valueLabel =
            limit.valueLabel ??
            (limit.remainingPercent === null
              ? "Unavailable"
              : `${limit.remainingPercent}% remaining`);

          return (
            <div key={limit.label}>
              <div className="mb-2 flex items-center justify-between gap-3 text-xs">
                <span className="font-medium text-muted-foreground">
                  {limit.label}
                </span>
                <span className="font-semibold text-foreground">
                  {valueLabel}
                </span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-emerald-500"
                  style={{ width: `${barPercent}%` }}
                />
              </div>
              {limit.resetLabel ? (
                <div className="mt-1 text-[10px] text-muted-foreground">
                  {limit.resetLabel}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
      <div className="mt-5 flex items-center justify-between gap-3 text-xs">
        <span className="text-muted-foreground">
          {card.activeCount} active · {card.queuedOrStartingCount} queued/starting
        </span>
        <span className="font-medium text-foreground">
          {getProviderCapacityStatusLine(card)}
        </span>
      </div>
    </Link>
  );
}

export function ProviderCapacityCards({ workspaceId }: ProviderCapacityCardsProps) {
  const trpc = useTRPC();
  const { data: workItems } = useQuery(
    trpc.workItem.list.queryOptions(
      { workspaceId: workspaceId ?? "", limit: 80 },
      { enabled: Boolean(workspaceId), refetchInterval: 10_000 },
    ),
  );
  const { data: runs } = useQuery(
    workspaceId
      ? trpc.agentRun.list.queryOptions(
          { workspaceId, limit: 100 },
          { refetchInterval: 10_000 },
        )
      : trpc.agentRun.listAll.queryOptions(
          { limit: 100 },
          { refetchInterval: 10_000 },
        ),
  );

  const cards = buildProviderCapacitySummaries({
    sessions: ((runs ?? []) as { id: string; status: string; agentType?: string | null }[]).map(
      (run): ProviderSessionSummary => ({
        id: run.id,
        status: run.status,
        agentType: run.agentType ?? "codex",
      }),
    ),
    workItems: (workItems ?? []) as WorkPipelineItem[],
    capacitySnapshots: extractProviderCapacitySnapshotsFromRuns(
      (runs ?? []) as ProviderCapacityRunSummary[],
    ),
  });

  return (
    <section className="grid gap-5 md:grid-cols-2">
      {cards.map((card) => (
        <ProviderCard key={card.provider} card={card} workspaceId={workspaceId} />
      ))}
    </section>
  );
}
