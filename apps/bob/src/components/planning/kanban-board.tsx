"use client";

import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { cn } from "@gmacko/core/ui";

import { useTRPC } from "~/trpc/react";
import { KanbanCard } from "./kanban-card";
import type { KanbanCardItem } from "./kanban-card";

// ---------------------------------------------------------------------------
// Column definitions
// ---------------------------------------------------------------------------

const KANBAN_COLUMNS = [
  { key: "backlog", label: "Backlog" },
  { key: "todo", label: "Todo" },
  { key: "in_progress", label: "In Progress" },
  { key: "in_review", label: "In Review" },
  { key: "done", label: "Done" },
  { key: "cancelled", label: "Cancelled" },
] as const;

const KNOWN_STATUSES = new Set<string>(KANBAN_COLUMNS.map((c) => c.key));

const STATUS_ALIAS: Record<string, string> = {
  ready: "todo",
  draft: "backlog",
  canceled: "cancelled",
};

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface KanbanBoardProps {
  workspaceId?: string;
  projectId?: string;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function KanbanBoard({ workspaceId, projectId }: KanbanBoardProps) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  const { data: workItems, isLoading } = useQuery(
    trpc.workItem.list.queryOptions(
      { workspaceId: workspaceId ?? "", projectId, limit: 100 },
      {
        enabled: !!workspaceId,
        refetchInterval: 15_000,
      },
    ),
  );

  const dispatchMutation = useMutation(
    trpc.workItem.dispatch.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: trpc.workItem.list.queryKey() });
      },
    }),
  );

  const handleDispatch = (id: string) => {
    dispatchMutation.mutate({ workItemId: id });
  };

  const updateMutation = useMutation(
    trpc.workItems.update.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: trpc.workItem.list.queryKey() });
      },
    }),
  );

  const handleStatusChange = (id: string, status: string) => {
    updateMutation.mutate({ id, status });
  };

  // Group items by status into columns
  const columns = useMemo(() => {
    const items = (workItems ?? []) as KanbanCardItem[];

    const grouped = new Map<string, KanbanCardItem[]>();
    const otherItems: KanbanCardItem[] = [];

    for (const item of items) {
      const mapped = STATUS_ALIAS[item.status] ?? item.status;
      if (KNOWN_STATUSES.has(mapped)) {
        const existing = grouped.get(mapped) ?? [];
        existing.push(item);
        grouped.set(mapped, existing);
      } else {
        otherItems.push(item);
      }
    }

    const result: { key: string; label: string; items: KanbanCardItem[] }[] =
      KANBAN_COLUMNS.map((col) => ({
        key: col.key as string,
        label: col.label as string,
        items: grouped.get(col.key) ?? [],
      }));

    if (otherItems.length > 0) {
      result.push({ key: "other", label: "Other", items: otherItems });
    }

    return result;
  }, [workItems]);

  if (!workspaceId) {
    return (
      <div className="rounded-lg border border-dashed border-border px-8 py-12 text-center">
        <p className="text-sm text-muted-foreground">
          Select a workspace to view the board.
        </p>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex gap-4 overflow-x-auto pb-4">
        {KANBAN_COLUMNS.map((col) => (
          <div
            key={col.key}
            className="min-w-[260px] flex-shrink-0 rounded-lg bg-muted/30 p-3"
          >
            <div className="mb-3 flex items-center justify-between">
              <div className="h-4 w-20 animate-pulse rounded bg-muted" />
              <div className="h-5 w-6 animate-pulse rounded-full bg-muted" />
            </div>
            <div className="space-y-2.5">
              {[0, 1].map((i) => (
                <div
                  key={i}
                  className="h-20 animate-pulse rounded-lg border border-border bg-card"
                />
              ))}
            </div>
          </div>
        ))}
      </div>
    );
  }

  const totalItems = columns.reduce((sum, col) => sum + col.items.length, 0);

  if (totalItems === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border px-8 py-12 text-center">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          className="mx-auto h-10 w-10 text-muted-foreground"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={1.5}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M9 17.25v1.007a3 3 0 01-.879 2.122L7.5 21h9l-.621-.621A3 3 0 0115 18.257V17.25m6-12V15a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 15V5.25m18 0A2.25 2.25 0 0018.75 3H5.25A2.25 2.25 0 003 5.25m18 0V12a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 12V5.25"
          />
        </svg>
        <h2 className="mt-4 font-display text-lg font-semibold text-foreground">
          No work items
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Create issues, tasks, or epics to see them on the board.
        </p>
      </div>
    );
  }

  return (
    <div className="flex gap-4 overflow-x-auto pb-4">
      {columns.map((col) => (
        <section
          key={col.key}
          className="min-w-[260px] max-w-[320px] flex-shrink-0 rounded-lg bg-muted/30 p-3"
        >
          {/* Column header */}
          <div className="mb-3 flex items-center justify-between">
            <h3 className="font-display text-sm font-semibold text-foreground">
              {col.label}
            </h3>
            <span
              className={cn(
                "rounded-full px-2 py-0.5 text-xs tabular-nums",
                col.items.length > 0
                  ? "bg-accent text-accent-foreground"
                  : "text-muted-foreground",
              )}
            >
              {col.items.length}
            </span>
          </div>

          {/* Cards */}
          <div className="max-h-[calc(100vh-280px)] space-y-2.5 overflow-y-auto pr-0.5">
            {col.items.length > 0 ? (
              col.items.map((item) => (
                <KanbanCard
                  key={item.id}
                  item={item}
                  workspaceId={workspaceId}
                  onDispatch={handleDispatch}
                  onStatusChange={handleStatusChange}
                />
              ))
            ) : (
              <div className="rounded-lg border border-dashed border-border px-3 py-6 text-center text-xs text-muted-foreground">
                No items
              </div>
            )}
          </div>
        </section>
      ))}
    </div>
  );
}
