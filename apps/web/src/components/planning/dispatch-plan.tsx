"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { Badge } from "@bob/ui/badge";
import { Button } from "@bob/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@bob/ui/select";
import { toast } from "@bob/ui/toast";

import { formatLabel } from "~/lib/design/colors";
import { useTRPC } from "~/trpc/react";

import type { badgeVariants } from "@bob/ui/badge";
import type { VariantProps } from "class-variance-authority";

type BadgeVariant = NonNullable<VariantProps<typeof badgeVariants>["variant"]>;

const DISPATCH_STATUS_COLOR: Record<string, BadgeVariant> = {
  queued: "slate",
  blocked: "amber",
  running: "blue",
  completed: "emerald",
  failed: "rose",
};

const PIPELINE_STATE_COLOR: Record<string, BadgeVariant> = {
  agent_complete: "slate",
  building: "blue",
  gates_passed: "emerald",
  deploying_dev: "blue",
  deploying_staging: "blue",
  deploying_prod: "blue",
  dev_healthy: "emerald",
  staging_healthy: "emerald",
  awaiting_prod_approval: "amber",
  prod_healthy: "emerald",
  complete: "emerald",
  build_failed: "rose",
  deploy_failed: "rose",
};

const ACTIVE_PIPELINE_STATES = new Set([
  "building",
  "deploying_dev",
  "deploying_staging",
  "deploying_prod",
]);

const PULSING_PIPELINE_STATES = new Set([
  "deploying_dev",
  "deploying_staging",
  "deploying_prod",
]);

function formatDuration(ms: number): string {
  if (ms < 60_000) return `${Math.floor(ms / 1000)}s`;
  if (ms < 3600_000)
    return `${Math.floor(ms / 60_000)}m ${Math.floor((ms % 60_000) / 1000)}s`;
  return `${Math.floor(ms / 3600_000)}h ${Math.floor((ms % 3600_000) / 60_000)}m`;
}

const AGENT_OPTIONS = [
  "claude",
  "codex",
  "opencode",
  "gemini",
  "kiro",
  "cursor-agent",
] as const;

interface DispatchPlanProps {
  batchId: string;
}

export function DispatchPlan({ batchId }: DispatchPlanProps) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    ...trpc.dispatch.getBatch.queryOptions({ batchId }),
    refetchInterval: 5000,
  });

  const updateAgent = useMutation(
    trpc.dispatch.updateItemAgent.mutationOptions({
      onSuccess: () => {
        void queryClient.invalidateQueries({
          queryKey: trpc.dispatch.getBatch.queryKey({ batchId }),
        });
      },
      onError: (err) => {
        toast(err.message, {
          style: { background: "#1a0000", borderColor: "#f43f5e40" },
        });
      },
    }),
  );

  const updateConcurrency = useMutation(
    trpc.dispatch.updateConcurrency.mutationOptions({
      onSuccess: () => {
        void queryClient.invalidateQueries({
          queryKey: trpc.dispatch.getBatch.queryKey({ batchId }),
        });
      },
      onError: (err) => {
        toast(err.message, {
          style: { background: "#1a0000", borderColor: "#f43f5e40" },
        });
      },
    }),
  );

  const dispatchBatch = useMutation(
    trpc.dispatch.dispatch.mutationOptions({
      onSuccess: (result) => {
        toast(`Dispatched ${result.started} task${result.started === 1 ? "" : "s"}`);
        void queryClient.invalidateQueries({
          queryKey: trpc.dispatch.getBatch.queryKey({ batchId }),
        });
      },
      onError: (err) => {
        toast(err.message, {
          style: { background: "#1a0000", borderColor: "#f43f5e40" },
        });
      },
    }),
  );

  const approveProd = useMutation(
    trpc.forgegraph.approveProdDeploy.mutationOptions({
      onSuccess: () => {
        toast("Production deploy approved");
        void queryClient.invalidateQueries({
          queryKey: trpc.dispatch.getBatch.queryKey({ batchId }),
        });
      },
      onError: (err) => {
        toast(err.message, {
          style: { background: "#1a0000", borderColor: "#f43f5e40" },
        });
      },
    }),
  );

  const resetPipeline = useMutation(
    trpc.dispatch.resetPipelineState.mutationOptions({
      onSuccess: () => {
        toast("Pipeline reset — will retry on next poll");
        void queryClient.invalidateQueries({
          queryKey: trpc.dispatch.getBatch.queryKey({ batchId }),
        });
      },
      onError: (err) => {
        toast(err.message, {
          style: { background: "#1a0000", borderColor: "#f43f5e40" },
        });
      },
    }),
  );

  if (isLoading || !data) {
    return (
      <div className="px-4 py-3 text-sm text-white/35">
        Loading dispatch plan...
      </div>
    );
  }

  const { batch, items } = data;
  const isDispatched = batch.status !== "pending";
  const isCompleted = batch.status === "completed";

  // Build a lookup from item ID to identifier for "blocked by" display
  const itemIdToIdentifier = new Map(
    items.map((item) => [item.id, item.planningTaskIdentifier]),
  );

  // Progress stats
  const total = batch.totalTasks;
  const completed = batch.completedTasks;
  const failed = batch.failedTasks;
  const running = items.filter((i) => i.status === "running").length;
  const queued = items.filter(
    (i) => i.status === "queued" || i.status === "blocked",
  ).length;
  const progressPct = total > 0 ? Math.round((completed / total) * 100) : 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-white/90">Dispatch Plan</h1>
        <Badge variant={DISPATCH_STATUS_COLOR[batch.status] ?? "slate"}>
          {formatLabel(batch.status)}
        </Badge>
      </div>

      {/* Completed banner */}
      {isCompleted && (
        <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-4 py-3 text-sm text-emerald-400">
          All tasks have been dispatched and completed.
          {failed > 0 && ` (${failed} failed)`}
        </div>
      )}

      {/* Progress section — shown after dispatch */}
      {isDispatched && (
        <div className="space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="text-white/60">
              {completed}/{total} complete
            </span>
            <span className="flex items-center gap-3 text-xs text-white/40">
              {running > 0 && (
                <span className="text-blue-400">{running} running</span>
              )}
              {queued > 0 && <span>{queued} queued</span>}
              {failed > 0 && (
                <span className="text-rose-400">{failed} failed</span>
              )}
            </span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-white/5">
            <div
              className="h-full rounded-full bg-emerald-500 transition-all duration-500"
              style={{ width: `${progressPct}%` }}
            />
          </div>
        </div>
      )}

      {/* Task table */}
      <div className="overflow-hidden rounded-lg border border-white/8">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-white/8 bg-white/[0.02]">
              <th className="px-4 py-2.5 text-left font-medium text-white/50">
                Task
              </th>
              <th className="px-4 py-2.5 text-left font-medium text-white/50">
                Agent
              </th>
              <th className="px-4 py-2.5 text-left font-medium text-white/50">
                Status
              </th>
              <th className="px-4 py-2.5 text-left font-medium text-white/50">
                Pipeline
              </th>
              <th className="px-4 py-2.5 text-left font-medium text-white/50">
                Blocked By
              </th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => {
              const blockers = (item.blockedByItems as string[]) ?? [];
              const blockerLabels = blockers
                .map((id) => itemIdToIdentifier.get(id))
                .filter(Boolean);

              return (
                <tr
                  key={item.id}
                  className="border-b border-white/5 last:border-b-0"
                >
                  {/* Task */}
                  <td className="px-4 py-2.5">
                    <div className="flex flex-col">
                      <span className="text-xs text-white/40">
                        {item.planningTaskIdentifier}
                      </span>
                      <span className="text-white/80">{item.title}</span>
                    </div>
                  </td>

                  {/* Agent */}
                  <td className="px-4 py-2.5">
                    <Select
                      value={item.agentType}
                      onValueChange={(value) =>
                        updateAgent.mutate({
                          itemId: item.id,
                          agentType: value,
                        })
                      }
                      disabled={
                        item.status === "running" ||
                        item.status === "completed" ||
                        item.status === "failed"
                      }
                    >
                      <SelectTrigger className="h-8 w-[140px] text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {AGENT_OPTIONS.map((agent) => (
                          <SelectItem key={agent} value={agent}>
                            {agent}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </td>

                  {/* Status */}
                  <td className="px-4 py-2.5">
                    <Badge
                      variant={
                        DISPATCH_STATUS_COLOR[item.status] ?? "slate"
                      }
                      className="text-[10px]"
                    >
                      {formatLabel(item.status)}
                    </Badge>
                  </td>

                  {/* Pipeline */}
                  <td className="px-4 py-2.5">
                    <PipelineCell
                      pipelineState={item.pipelineState as string | null}
                      updatedAt={item.updatedAt as string | Date | null}
                      itemId={item.id}
                      onApproveProd={() =>
                        approveProd.mutate({ dispatchItemId: item.id })
                      }
                      onRetry={() =>
                        resetPipeline.mutate({ itemId: item.id })
                      }
                      isApproving={approveProd.isPending}
                      isRetrying={resetPipeline.isPending}
                    />
                  </td>

                  {/* Blocked By */}
                  <td className="px-4 py-2.5 text-xs text-white/40">
                    {blockerLabels.length > 0
                      ? blockerLabels.join(", ")
                      : "\u2014"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Controls */}
      {!isCompleted && (
        <div className="flex items-center justify-between border-t border-white/8 pt-4">
          <div className="flex items-center gap-3">
            <label
              htmlFor="concurrency"
              className="text-sm text-white/50"
            >
              Concurrency
            </label>
            <input
              id="concurrency"
              type="number"
              min={1}
              max={10}
              value={batch.concurrency}
              onChange={(e) => {
                const val = parseInt(e.target.value, 10);
                if (val >= 1 && val <= 10) {
                  updateConcurrency.mutate({
                    batchId,
                    concurrency: val,
                  });
                }
              }}
              className="h-8 w-16 rounded-md border border-white/10 bg-white/[0.03] px-2 text-center text-sm text-white/80 focus:border-white/20 focus:outline-none"
            />
          </div>
          <Button
            onClick={() => dispatchBatch.mutate({ batchId })}
            disabled={dispatchBatch.isPending || isDispatched}
          >
            {dispatchBatch.isPending ? "Dispatching..." : "Dispatch"}
          </Button>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Pipeline cell with badge, time-in-stage counter, and action btns  */
/* ------------------------------------------------------------------ */

function PipelineCell({
  pipelineState,
  updatedAt,
  itemId,
  onApproveProd,
  onRetry,
  isApproving,
  isRetrying,
}: {
  pipelineState: string | null;
  updatedAt: string | Date | null;
  itemId: string;
  onApproveProd: () => void;
  onRetry: () => void;
  isApproving: boolean;
  isRetrying: boolean;
}) {
  if (!pipelineState) return <span className="text-xs text-white/25">{"\u2014"}</span>;

  const variant = PIPELINE_STATE_COLOR[pipelineState] ?? "slate";
  const isPulsing = PULSING_PIPELINE_STATES.has(pipelineState) || pipelineState === "building";
  const isActive = ACTIVE_PIPELINE_STATES.has(pipelineState);
  const isFailed = pipelineState === "build_failed" || pipelineState === "deploy_failed";
  const isAwaitingApproval = pipelineState === "awaiting_prod_approval";

  return (
    <div className="flex items-center gap-2">
      <Badge
        variant={variant}
        className={`text-[10px]${isPulsing ? " animate-pulse" : ""}`}
      >
        {formatLabel(pipelineState)}
      </Badge>

      {isActive && updatedAt && (
        <ElapsedTimer since={updatedAt} />
      )}

      {isAwaitingApproval && (
        <Button
          size="sm"
          variant="outline"
          className="h-6 px-2 text-[10px]"
          onClick={onApproveProd}
          disabled={isApproving}
        >
          {isApproving ? "Approving..." : "Approve Prod"}
        </Button>
      )}

      {isFailed && (
        <Button
          size="sm"
          variant="outline"
          className="h-6 px-2 text-[10px]"
          onClick={onRetry}
          disabled={isRetrying}
        >
          {isRetrying ? "Retrying..." : "Retry"}
        </Button>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Live elapsed-time counter for active pipeline states               */
/* ------------------------------------------------------------------ */

function ElapsedTimer({ since }: { since: string | Date }) {
  const [now, setNow] = useState(Date.now);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const elapsed = now - new Date(since).getTime();
  if (elapsed < 0) return null;

  return (
    <span className="text-[10px] tabular-nums text-white/40">
      {formatDuration(elapsed)}
    </span>
  );
}
