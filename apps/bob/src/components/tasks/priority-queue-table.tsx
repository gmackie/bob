"use client";

import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { Badge } from "@gmacko/core/ui/badge";

import { useTRPC } from "~/trpc/react";
import {
  buildPriorityQueueRows,
  buildPriorityQueueSaveOrder,
  canMovePriorityQueueRow,
  formatTaskPriority,
  getPriorityQueueHeaderModel,
  getPriorityQueueWorkItemHref,
  getPriorityQueueRowAction,
  getPriorityQueueSessionHref,
  movePriorityQueueRow,
  type PriorityQueueMoveDirection,
  type PriorityQueueItem,
} from "./task-shell-model";

interface PriorityQueueTableProps {
  workspaceId?: string;
}

function formatStatus(status: string): string {
  return status.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function statusVariant(status: string): "default" | "slate" | "blue" | "amber" | "emerald" | "rose" {
  if (status === "blocked") return "rose";
  if (status === "in_progress" || status === "running") return "blue";
  if (status === "in_review" || status === "review") return "amber";
  return "slate";
}

export function PriorityQueueTable({ workspaceId }: PriorityQueueTableProps) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const listInput = { workspaceId: workspaceId ?? "", limit: 100 };
  const { data: workItems, isLoading } = useQuery(
    trpc.workItem.list.queryOptions(
      listInput,
      { enabled: Boolean(workspaceId), refetchInterval: 10_000 },
    ),
  );
  const rows = buildPriorityQueueRows((workItems ?? []) as PriorityQueueItem[]);
  const header = getPriorityQueueHeaderModel();

  const reorderQueue = useMutation(
    trpc.workItems.reorderQueue.mutationOptions({
      onSuccess: async () => {
        await queryClient.invalidateQueries({
          queryKey: trpc.workItem.list.queryKey(listInput),
        });
      },
    }),
  );
  const dispatchWork = useMutation(
    trpc.workItem.dispatch.mutationOptions({
      onSuccess: async () => {
        await queryClient.invalidateQueries({
          queryKey: trpc.workItem.list.queryKey(listInput),
        });
      },
    }),
  );

  function saveQueue(nextRows: PriorityQueueItem[]) {
    if (!workspaceId || nextRows.length === 0) return;
    reorderQueue.mutate({
      workspaceId,
      workItemIds: buildPriorityQueueSaveOrder(nextRows),
    });
  }

  function moveRow(itemId: string, direction: PriorityQueueMoveDirection) {
    const nextRows = movePriorityQueueRow(rows, itemId, direction);
    if (nextRows === rows) return;
    saveQueue(nextRows);
  }

  if (!workspaceId) {
    return (
      <div className="rounded-lg border border-dashed border-border px-8 py-12 text-center">
        <p className="text-sm text-muted-foreground">
          Select a workspace to view the priority queue.
        </p>
      </div>
    );
  }

  return (
    <section className="rounded-lg border border-border bg-card">
      <div className="flex items-center justify-between gap-4 border-b border-border px-5 py-4">
        <div>
          <h1 className="font-display text-lg font-semibold text-foreground">
            {header.title}
          </h1>
          {header.subtitle ? (
            <p className="mt-1 text-sm text-muted-foreground">{header.subtitle}</p>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span className="text-xs text-muted-foreground">
            {reorderQueue.isPending ? "Saving..." : "Queue saved"}
          </span>
          <button
            type="button"
            onClick={() => saveQueue(rows)}
            disabled={rows.length === 0 || reorderQueue.isPending}
            className="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-muted/50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Save queue
          </button>
          <button
            type="button"
            onClick={() => saveQueue(buildPriorityQueueRows((workItems ?? []) as PriorityQueueItem[]))}
            disabled={rows.length === 0 || reorderQueue.isPending}
            className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Sort by priority
          </button>
          <span className="ml-1 text-sm font-semibold tabular-nums text-muted-foreground">
            {rows.length}
          </span>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[920px] text-left text-sm">
          <thead className="border-b border-border text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-5 py-3 font-semibold">Priority</th>
              <th className="px-5 py-3 font-semibold">ID</th>
              <th className="px-5 py-3 font-semibold">Title</th>
              <th className="px-5 py-3 font-semibold">Status</th>
              <th className="px-5 py-3 font-semibold">Queue</th>
              <th className="px-5 py-3 font-semibold">Move</th>
              <th className="px-5 py-3 font-semibold">Action</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              [0, 1, 2].map((row) => (
                <tr key={row} className="border-b border-border">
                  <td className="px-5 py-4" colSpan={7}>
                    <div className="h-4 animate-pulse rounded bg-muted/50" />
                  </td>
                </tr>
              ))
            ) : rows.length === 0 ? (
              <tr>
                <td className="px-5 py-6 text-muted-foreground" colSpan={7}>
                  No queued work items.
                </td>
              </tr>
            ) : (
              rows.map((item, index) => {
                const action = getPriorityQueueRowAction(item);
                const rowBusy =
                  reorderQueue.isPending ||
                  (dispatchWork.isPending && dispatchWork.variables?.workItemId === item.id);

                return (
                  <tr key={item.id} className="border-b border-border last:border-b-0">
                    <td className="px-5 py-3">
                      <Badge variant="slate">
                        {formatTaskPriority(item.priority)}
                      </Badge>
                    </td>
                    <td className="px-5 py-3 font-medium text-muted-foreground">
                      {item.identifier}
                    </td>
                    <td className="px-5 py-3">
                      <Link
                        href={getPriorityQueueWorkItemHref(item.id, workspaceId)}
                        className="font-medium text-foreground transition-colors hover:text-primary"
                      >
                        {item.title}
                      </Link>
                    </td>
                    <td className="px-5 py-3">
                      <Badge variant={statusVariant(item.status)}>
                        {formatStatus(item.status)}
                      </Badge>
                    </td>
                    <td className="px-5 py-3 text-muted-foreground">
                      {item.queueSortOrder ?? index + 1}
                    </td>
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => moveRow(item.id, "up")}
                          disabled={!canMovePriorityQueueRow(rows, item.id, "up") || rowBusy}
                          className="rounded border border-border px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          Up
                        </button>
                        <button
                          type="button"
                          onClick={() => moveRow(item.id, "down")}
                          disabled={!canMovePriorityQueueRow(rows, item.id, "down") || rowBusy}
                          className="rounded border border-border px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          Down
                        </button>
                      </div>
                    </td>
                    <td className="px-5 py-3">
                      {action.kind === "live-session" ? (
                        <Link
                          href={getPriorityQueueSessionHref(action.sessionId, workspaceId)}
                          className="rounded-md bg-amber-500/10 px-3 py-1.5 text-xs font-medium text-amber-500 transition-colors hover:bg-amber-500/20"
                        >
                          Live
                        </Link>
                      ) : action.kind === "dispatch" ? (
                        <button
                          type="button"
                          onClick={() => dispatchWork.mutate({ workItemId: item.id })}
                          disabled={rowBusy}
                          className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {rowBusy ? "Starting..." : "Start"}
                        </button>
                      ) : (
                        <span className="text-xs text-muted-foreground">-</span>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
