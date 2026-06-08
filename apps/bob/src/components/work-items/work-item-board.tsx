import Link from "next/link";
import React from "react";

import { cn } from "@gmacko/core/ui";
import { Badge } from "@gmacko/core/ui/badge";

import { getProjectWorkItemHref } from "~/components/projects/project-detail-tabs-model";
import { KIND_COLOR, PRIORITY_COLOR } from "~/lib/design/colors";

import {
  type PlanningWorkItem,
  groupWorkItemsByStatus,
} from "./planning-utils";

export interface WorkItemBoardItem extends PlanningWorkItem {
  identifier: string;
  kind: string;
  priority?: string;
  workspaceId?: string | null;
  href?: string;
  dispatchStatus?: string; // queued | blocked | running | completed | failed
  dispatchAgent?: string;
}

const DISPATCH_DOT: Record<string, string> = {
  queued: "bg-slate-400",
  blocked: "bg-amber-400",
  running: "bg-blue-400 animate-pulse",
  completed: "bg-emerald-400",
  failed: "bg-rose-400",
};

interface WorkItemBoardProps {
  items: WorkItemBoardItem[];
}

const COLUMN_ORDER = [
  { key: "backlog", title: "Backlog" },
  { key: "todo", title: "Ready" },
  { key: "inProgress", title: "In Progress" },
  { key: "inReview", title: "In Review" },
  { key: "done", title: "Done" },
] as const;

const PRIORITY_BORDER: Record<string, string> = {
  urgent: "border-l-rose-500",
  high: "border-l-orange-500",
  medium: "border-l-amber-500",
  low: "border-l-blue-500",
};

export function WorkItemBoard({ items }: WorkItemBoardProps) {
  const grouped = groupWorkItemsByStatus(items);

  return (
    <div className="grid gap-4 xl:grid-cols-5">
      {COLUMN_ORDER.map((column) => {
        const columnItems = grouped[column.key];

        return (
          <section
            key={column.key}
            className="rounded-2xl border border-border bg-secondary p-4"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-foreground">{column.title}</h3>
              <span className="rounded-full bg-accent px-2 py-0.5 text-xs text-muted-foreground">
                {columnItems.length}
              </span>
            </div>
            <div className="mt-4 space-y-3">
              {columnItems.length === 0 ? (
                <div className="min-h-[2rem]" />
              ) : (
                columnItems.map((item) => {
                  const boardItem = item as WorkItemBoardItem;
                  const priorityBorder =
                    boardItem.priority
                      ? PRIORITY_BORDER[boardItem.priority]
                      : undefined;

                  return (
                    <Link
                      key={item.id}
                      href={boardItem.href ?? getProjectWorkItemHref(boardItem)}
                      className={`block rounded-xl border border-border bg-card px-3 py-3 transition hover:border-muted-foreground/30 hover:shadow-sm ${
                        priorityBorder ? `border-l-2 ${priorityBorder}` : ""
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
                          {boardItem.identifier}
                        </span>
                        <Badge
                          variant={KIND_COLOR[boardItem.kind] ?? "default"}
                          className="text-[10px] px-1.5 py-0"
                        >
                          {boardItem.kind}
                        </Badge>
                      </div>
                      <div className="mt-2 text-sm font-medium text-foreground">
                        {item.title}
                      </div>
                      {boardItem.dispatchStatus && (
                        <div className="mt-2 flex items-center gap-1.5">
                          <span
                            className={cn(
                              "size-2 rounded-full",
                              DISPATCH_DOT[boardItem.dispatchStatus] ??
                                "bg-slate-400",
                            )}
                            title={`Dispatch: ${boardItem.dispatchStatus}`}
                          />
                          {boardItem.dispatchAgent && (
                            <span className="text-[10px] text-muted-foreground">
                              {boardItem.dispatchAgent}
                            </span>
                          )}
                        </div>
                      )}
                    </Link>
                  );
                })
              )}
            </div>
          </section>
        );
      })}
    </div>
  );
}
