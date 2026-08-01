"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { HostSnapshotWire } from "@bob/ws";

import { cn } from "@gmacko/core/ui";

import { useBobRpcClient } from "~/rpc/react";
import { useSessionSocket } from "~/hooks/use-session-socket";
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
import {
  buildHostMissionControl,
  buildHostMissionControlFromHeartbeat,
} from "./mission-control-model";

interface ProviderCapacityCardsProps {
  workspaceId?: string;
}

type ProviderCapacityRun = ProviderCapacityRunSummary & ProviderSessionSummary;

type WorkspaceHeartbeatRow = {
  workspace?: {
    id: string;
    name?: string | null;
    slug?: string | null;
    lastHeartbeat?: Date | string | null;
  } | null;
};

const TONE_CLASS: Record<DashboardTone, string> = {
  default: "bg-muted-foreground",
  warning: "bg-amber-500",
  danger: "bg-rose-500",
  success: "bg-emerald-500",
};

// Compact capacity chip: one slim pill per provider (tone dot · label ·
// primary-limit % · active/queued). Replaces the former hero-sized usage-bar
// card so the strip no longer pushes the work pipeline below the fold — the
// full per-limit breakdown lives on the provider detail page this links to.
function ProviderCapacityChip({
  card,
  workspaceId,
}: {
  card: ProviderCapacitySummary;
  workspaceId?: string | null;
}) {
  const primary = card.usageLimits[0];
  const remainingLabel = primary
    ? primary.valueLabel ??
      (primary.remainingPercent === null
        ? "Unavailable"
        : `${primary.remainingPercent}%`)
    : null;
  const hasActivity = card.activeCount > 0 || card.queuedOrStartingCount > 0;

  return (
    <Link
      href={getProviderCapacityHref(card.provider, workspaceId)}
      title={getProviderCapacityStatusLine(card)}
      className="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-1.5 text-xs transition-colors hover:bg-muted/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
    >
      <span
        className={cn("size-2 shrink-0 rounded-full", TONE_CLASS[card.tone])}
        aria-hidden="true"
      />
      <span className="font-semibold text-foreground">{card.label}</span>
      {remainingLabel ? (
        <span className="text-muted-foreground">{remainingLabel}</span>
      ) : null}
      {hasActivity ? (
        <span className="tabular-nums text-muted-foreground">
          · {card.activeCount} active
          {card.queuedOrStartingCount > 0
            ? ` · ${card.queuedOrStartingCount} queued`
            : ""}
        </span>
      ) : null}
    </Link>
  );
}

export function ProviderCapacityCards({ workspaceId }: ProviderCapacityCardsProps) {
  const rpc = useBobRpcClient();
  const trpc = useTRPC();
  const workItemsInput = { workspaceId: workspaceId ?? "", limit: 80 };
  const { data: workItems } = useQuery({
    queryKey: ["rpc", "workItem.list", workItemsInput],
    queryFn: () =>
      rpc.workItems.list(workItemsInput) as Promise<WorkPipelineItem[]>,
    enabled: Boolean(workspaceId),
    refetchInterval: 10_000,
  });
  const runsQueryOptions = (
    workspaceId
      ? trpc.agentRun.list.queryOptions(
          { workspaceId, limit: 100 },
          { refetchInterval: 10_000 },
        )
      : trpc.agentRun.listAll.queryOptions(
          { limit: 100 },
          { refetchInterval: 10_000 },
        )
  ) as ReturnType<typeof trpc.agentRun.listAll.queryOptions>;
  const { data: runRows } = useQuery(runsQueryOptions);
  const runs = (Array.isArray(runRows) ? runRows : []) as ProviderCapacityRun[];
  const { data: workspaceRows } = useQuery(
    trpc.workspace.list.queryOptions(undefined, {
      staleTime: 30_000,
      refetchInterval: 30_000,
    }),
  );
  // Live per-provider health (installed / authenticated / ready / degraded)
  // from the execution host, streamed over the gateway WS. The snapshot lives
  // in-memory on the gateway (not persisted), so we subscribe to the workspace
  // to receive the current snapshot on connect + broadcasts on change.
  const [hostSnapshot, setHostSnapshot] = useState<HostSnapshotWire | null>(
    null,
  );
  const { data: gatewayInfo } = useQuery(
    trpc.session.getGatewayWebSocketUrl.queryOptions(undefined, {
      enabled: Boolean(workspaceId),
    }),
  );
  const { connectionState, subscribeWorkspace } = useSessionSocket({
    gatewayUrl: gatewayInfo?.url ?? "",
    token: gatewayInfo?.token ?? "",
    enabled: Boolean(workspaceId && gatewayInfo?.url && gatewayInfo?.token),
    onHostSnapshot: (_ws, snapshot) => setHostSnapshot(snapshot),
  });
  useEffect(() => {
    if (connectionState.status !== "connected" || !workspaceId) return;
    subscribeWorkspace(undefined, workspaceId);
  }, [connectionState.status, workspaceId, subscribeWorkspace]);

  const cards = buildProviderCapacitySummaries({
    sessions: runs.map(
      (run): ProviderSessionSummary => ({
        id: run.id,
        status: run.status,
        agentType: run.agentType ?? "codex",
      }),
    ),
    workItems: workItems ?? [],
    capacitySnapshots: extractProviderCapacitySnapshotsFromRuns(
      runs,
    ),
  });

  const heartbeatWorkspace = (
    (Array.isArray(workspaceRows) ? workspaceRows : []) as WorkspaceHeartbeatRow[]
  )
    .map((row) => row.workspace)
    .find((workspace) => workspace?.id === workspaceId);
  const host = hostSnapshot
    ? buildHostMissionControl(hostSnapshot)
    : heartbeatWorkspace
      ? buildHostMissionControlFromHeartbeat({
          hostId:
            heartbeatWorkspace.name ?? heartbeatWorkspace.slug ?? "Execution host",
          lastHeartbeat: heartbeatWorkspace.lastHeartbeat,
        })
      : null;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-xs text-muted-foreground" data-testid="host-status">
        <span className="font-semibold text-foreground">{host?.hostId ?? "Execution host"}</span>
        <span>{host?.statusLabel ?? "Waiting for heartbeat"}</span>
        {host ? <span>{host.queueLabel}</span> : null}
        {host?.providers.map((provider) => (
          <span key={provider.provider} title={`Controls: ${provider.controls.join(", ") || "none"}`}>
            {provider.label}: {provider.statusLabel}
          </span>
        ))}
      </div>
      <section className="flex flex-wrap gap-2" aria-label="Provider capacity">
        {cards.map((card) => (
          <ProviderCapacityChip key={card.provider} card={card} workspaceId={workspaceId} />
        ))}
      </section>
    </div>
  );
}
