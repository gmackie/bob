"use client";

import React, { useState } from "react";

import { cn } from "@gmacko/core/ui";

import type { WorkItemBoardItem } from "~/components/work-items/work-item-board";
import { FilterableBoard } from "~/components/work-items/board-filter-bar";

import { FlowGraph, type FlowGraphItem } from "./flow-graph";
import { PipelineTimeline } from "./pipeline-timeline";

type ViewMode = "board" | "graph" | "timeline";

interface ViewSwitcherProps {
  items: WorkItemBoardItem[];
  projects?: Array<{ id: string; key: string }>;
}

const VIEW_OPTIONS: Array<{ key: ViewMode; label: string; icon: string }> = [
  { key: "board", label: "Board", icon: "▦" },
  { key: "graph", label: "Graph", icon: "◈" },
  { key: "timeline", label: "Timeline", icon: "▬" },
];

export function ViewSwitcher({ items, projects }: ViewSwitcherProps) {
  const [view, setView] = useState<ViewMode>("board");

  const graphItems: FlowGraphItem[] = items.map((item) => ({
    id: item.id,
    identifier: item.identifier,
    title: item.title,
    status: item.status,
    kind: item.kind,
    priority: item.priority,
    parentId: (item as any).parentId,
    dispatchStatus: item.dispatchStatus,
    dispatchAgent: item.dispatchAgent,
    pipelineState: (item as any).pipelineState,
  }));

  return (
    <div>
      {/* View toggle */}
      <div className="mb-4 flex items-center justify-between">
        <div className="flex rounded-lg border border-border bg-card">
          {VIEW_OPTIONS.map((opt) => (
            <button
              key={opt.key}
              onClick={() => setView(opt.key)}
              className={cn(
                "flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium transition-colors",
                view === opt.key
                  ? "bg-accent text-foreground"
                  : "text-muted-foreground hover:text-foreground",
                opt.key === "board" && "rounded-l-lg",
                opt.key === "timeline" && "rounded-r-lg",
              )}
            >
              <span>{opt.icon}</span>
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Views */}
      {view === "board" && (
        <FilterableBoard items={items} projects={projects} />
      )}

      {view === "graph" && (
        <div className="rounded-2xl border border-border bg-popover" style={{ height: 600 }}>
          <FlowGraph items={graphItems} />
        </div>
      )}

      {view === "timeline" && (
        <PipelineTimeline items={graphItems} />
      )}
    </div>
  );
}
