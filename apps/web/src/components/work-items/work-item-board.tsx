import Link from "next/link";
import React from "react";

import { Badge } from "@bob/ui/badge";

import { KIND_COLOR, PRIORITY_COLOR } from "~/lib/design/colors";

import {
  type PlanningWorkItem,
  groupWorkItemsByStatus,
} from "./planning-utils";

export interface WorkItemBoardItem extends PlanningWorkItem {
  identifier: string;
  kind: string;
  priority?: string;
}

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
            className="rounded-2xl border border-white/10 bg-black/20 p-4"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-white">{column.title}</h3>
              <span className="rounded-full bg-white/10 px-2 py-0.5 text-xs text-white/60">
                {columnItems.length}
              </span>
            </div>
            <div className="mt-4 space-y-3">
              {columnItems.length === 0 ? (
                <div className="rounded-xl border border-dashed border-white/10 px-3 py-6 text-center text-xs text-white/35">
                  No items
                </div>
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
                      href={`/work-items/${item.id}`}
                      className={`block rounded-xl border border-white/10 bg-white/[0.04] px-3 py-3 transition hover:border-white/20 hover:bg-white/[0.06] ${
                        priorityBorder ? `border-l-2 ${priorityBorder}` : ""
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[11px] uppercase tracking-[0.18em] text-white/40">
                          {boardItem.identifier}
                        </span>
                        <Badge
                          variant={KIND_COLOR[boardItem.kind] ?? "default"}
                          className="text-[10px] px-1.5 py-0"
                        >
                          {boardItem.kind}
                        </Badge>
                      </div>
                      <div className="mt-2 text-sm font-medium text-white">
                        {item.title}
                      </div>
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
