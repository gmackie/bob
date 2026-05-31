import React from "react";
import Link from "next/link";

import { cn } from "@bob/ui";
import { Badge } from "@bob/ui/badge";

import type { PlanningWorkItem } from "./planning-utils";
import { KIND_COLOR, PRIORITY_COLOR } from "~/lib/design/colors";
import {
  dedupeWorkItemsByBoardIdentity,
  groupWorkItemsByStatus,
} from "./planning-utils";

export interface WorkItemBoardItem extends PlanningWorkItem {
  identifier: string;
  kind: string;
  priority?: string;
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
  const grouped = groupWorkItemsByStatus(dedupeWorkItemsByBoardIdentity(items));

  return (
    <div className="grid gap-4 xl:grid-cols-5">
      {COLUMN_ORDER.map((column) => {
        const columnItems = grouped[column.key];

        return (
          <section
            key={column.key}
            className="border-border bg-secondary rounded-2xl border p-4"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-foreground text-sm font-semibold">
                {column.title}
              </h3>
              <span className="bg-accent text-muted-foreground rounded-full px-2 py-0.5 text-xs">
                {columnItems.length}
              </span>
            </div>
            <div className="mt-4 space-y-3">
              {columnItems.length === 0 ? (
                <div className="min-h-[2rem]" />
              ) : (
                columnItems.map((item) => {
                  const boardItem = item as WorkItemBoardItem;
                  const priorityBorder = boardItem.priority
                    ? PRIORITY_BORDER[boardItem.priority]
                    : undefined;

                  return (
                    <Link
                      key={item.id}
                      href={`/work-items/${item.id}`}
                      className={`border-border bg-card hover:border-muted-foreground/30 block rounded-xl border px-3 py-3 transition hover:shadow-sm ${
                        priorityBorder ? `border-l-2 ${priorityBorder}` : ""
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-muted-foreground font-mono text-[11px] tracking-[0.18em] uppercase">
                          {boardItem.identifier}
                        </span>
                        <Badge
                          variant={KIND_COLOR[boardItem.kind] ?? "default"}
                          className="px-1.5 py-0 text-[10px]"
                        >
                          {boardItem.kind}
                        </Badge>
                      </div>
                      <div className="text-foreground mt-2 text-sm font-medium">
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
                            <span className="text-muted-foreground text-[10px]">
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
