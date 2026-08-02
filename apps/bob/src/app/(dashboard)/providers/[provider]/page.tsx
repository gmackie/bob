"use client";

import { use } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeftIcon } from "@radix-ui/react-icons";

import { cn } from "@gmacko/core/ui";
import { Card } from "@gmacko/core/ui/card";

import { Breadcrumbs } from "~/components/layout/breadcrumbs";
import { useBobRpcClient } from "~/rpc/react";
import { useTRPC } from "~/trpc/react";
import { getProvider } from "~/lib/providers";
import {
  buildProviderCapacitySummaries,
  extractProviderCapacitySnapshotsFromRuns,
  getProviderCapacityStatusLine,
  type DashboardTone,
  type ProviderCapacitySummary,
  type ProviderSessionSummary,
  type WorkPipelineItem,
} from "~/components/dashboard/work-pipeline-model";

const TONE_TEXT: Record<DashboardTone, string> = {
  default: "text-muted-foreground",
  warning: "text-amber-500",
  danger: "text-rose-500",
  success: "text-emerald-500",
};
const TONE_DOT: Record<DashboardTone, string> = {
  default: "bg-muted-foreground",
  warning: "bg-amber-500",
  danger: "bg-rose-500",
  success: "bg-emerald-500",
};

// Full per-limit breakdown for one provider — the depth behind the compact
// capacity chip on /tasks. Usage bars + reset labels render defaults until the
// runner reports real quota (metered providers show "Unavailable" bars,
// subscription providers a single "Subscription" row) and light up automatically
// once a collector populates run.summary.providerCapacity.
function UsageLimits({ card }: { card: ProviderCapacitySummary }) {
  return (
    <div className="space-y-5">
      {card.usageLimits.map((limit) => {
        const barPercent = limit.barPercent ?? limit.remainingPercent ?? 0;
        const valueLabel =
          limit.valueLabel ??
          (limit.remainingPercent === null
            ? "Unavailable"
            : `${limit.remainingPercent}% remaining`);
        return (
          <div key={limit.label}>
            <div className="mb-2 flex items-center justify-between gap-3 text-sm">
              <span className="font-medium text-muted-foreground">{limit.label}</span>
              <span className="font-semibold text-foreground tabular-nums">{valueLabel}</span>
            </div>
            <div className="h-2.5 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-emerald-500"
                style={{ width: `${Math.max(0, Math.min(100, barPercent))}%` }}
              />
            </div>
            {limit.resetLabel ? (
              <div className="mt-1.5 text-xs text-muted-foreground">{limit.resetLabel}</div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

export default function ProviderDetailPage({
  params,
}: {
  params: Promise<{ provider: string }>;
}) {
  const { provider: providerParam } = use(params);
  const rpc = useBobRpcClient();
  const trpc = useTRPC();
  const searchParams = useSearchParams();
  const workspaceId = searchParams?.get("workspace") ?? "";

  const def = getProvider(providerParam);

  const { data: workItems } = useQuery({
    queryKey: ["rpc", "workItem.list", "provider-detail", workspaceId],
    queryFn: () =>
      rpc.workItems.list({ workspaceId: workspaceId || "", limit: 80 }) as Promise<
        WorkPipelineItem[]
      >,
    enabled: Boolean(workspaceId),
    refetchInterval: 10_000,
  });
  const runsQueryOptions = (
    workspaceId
      ? trpc.agentRun.list.queryOptions({ workspaceId, limit: 100 }, { refetchInterval: 10_000 })
      : trpc.agentRun.listAll.queryOptions({ limit: 100 }, { refetchInterval: 10_000 })
  ) as ReturnType<typeof trpc.agentRun.listAll.queryOptions>;
  const { data: runRows } = useQuery(runsQueryOptions);
  const runs = (Array.isArray(runRows) ? runRows : []) as {
    id: string;
    status: string;
    agentType?: string | null;
    summary?: Record<string, unknown>;
  }[];

  const cards = buildProviderCapacitySummaries({
    sessions: runs.map(
      (run): ProviderSessionSummary => ({
        id: run.id,
        status: run.status,
        agentType: run.agentType ?? "codex",
      }),
    ),
    workItems: workItems ?? [],
    capacitySnapshots: extractProviderCapacitySnapshotsFromRuns(runs as never),
  });
  // Match on the normalized provider key (cards are keyed by ProviderKey).
  const card = cards.find((c) => c.provider === def?.id || c.provider === providerParam);

  const runsHref = `/runs?provider=${encodeURIComponent(
    providerParam === "cursor-agent" ? "cursor" : providerParam,
  )}${workspaceId ? `&workspace=${encodeURIComponent(workspaceId)}` : ""}`;

  return (
    <div className="flex flex-col gap-6 p-6">
      <Breadcrumbs items={[{ label: "Providers" }, { label: def?.label ?? providerParam }]} />

      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <span className="text-3xl" aria-hidden="true">{def?.icon ?? "•"}</span>
          <div>
            <h1 className="font-display text-2xl font-bold tracking-tight">
              {def?.label ?? providerParam}
            </h1>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {def
                ? def.metered
                  ? "Metered API quota"
                  : "Subscription plan"
                : "Unknown provider"}
              {card ? <> · {getProviderCapacityStatusLine(card)}</> : null}
            </p>
          </div>
        </div>
        <Link
          href="/tasks"
          className="text-muted-foreground hover:text-foreground flex items-center gap-1 text-sm"
        >
          <ArrowLeftIcon className="size-3.5" /> Mission Control
        </Link>
      </div>

      {!def ? (
        <Card className="p-8">
          <h2 className="font-display text-lg font-semibold">Unknown provider</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            No provider named <span className="font-mono">{providerParam}</span> is registered.
          </p>
        </Card>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-3">
            <Card className="p-5">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Active
              </p>
              <p className={cn("mt-1 text-2xl font-semibold tabular-nums", card && TONE_TEXT[card.tone])}>
                {card?.activeCount ?? 0}
              </p>
            </Card>
            <Card className="p-5">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Queued / starting
              </p>
              <p className="mt-1 text-2xl font-semibold tabular-nums">
                {card?.queuedOrStartingCount ?? 0}
              </p>
            </Card>
            <Card className="p-5">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Status
              </p>
              <div className="mt-2 flex items-center gap-2">
                <span
                  className={cn("size-2.5 rounded-full", card ? TONE_DOT[card.tone] : "bg-muted-foreground")}
                  aria-hidden="true"
                />
                <span className="text-sm font-medium">{card?.statusLabel ?? "Unknown"}</span>
              </div>
            </Card>
          </div>

          <Card className="p-6">
            <h2 className="font-display text-base font-semibold text-foreground">Usage limits</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {def.metered
                ? "Metered quota reported by the execution host."
                : "Subscription capacity — no hard per-run meter."}
            </p>
            <div className="mt-5">
              {card ? (
                <UsageLimits card={card} />
              ) : (
                <p className="text-sm text-muted-foreground">
                  No capacity data yet for {def.label}.
                </p>
              )}
            </div>
          </Card>

          <Link
            href={runsHref}
            className="hover:border-primary/30 flex items-center justify-between gap-3 rounded-lg border border-border bg-card px-5 py-4 transition-colors"
          >
            <span className="text-sm font-medium">Recent {def.label} runs</span>
            <span className="text-sm text-primary">View runs →</span>
          </Link>
        </>
      )}
    </div>
  );
}
