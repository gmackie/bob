"use client";

import React from "react";
import Link from "next/link";

import { cn } from "@bob/ui";
import { Badge } from "@bob/ui/badge";

import { KIND_COLOR, STATUS_COLOR, formatLabel } from "~/lib/design/colors";

import type { FlowGraphItem } from "./flow-graph";

interface PipelineTimelineProps {
  items: FlowGraphItem[];
  className?: string;
}

const PIPELINE_STAGES = [
  { key: "backlog", label: "Backlog" },
  { key: "todo", label: "Ready" },
  { key: "in_progress", label: "In Progress" },
  { key: "building", label: "Building" },
  { key: "deploying", label: "Deploying" },
  { key: "in_review", label: "In Review" },
  { key: "done", label: "Done" },
] as const;

function getStageIndex(item: FlowGraphItem): number {
  // Map work item status + pipeline state to a stage column
  if (item.pipelineState) {
    if (["building", "gates_passed"].includes(item.pipelineState)) return 3;
    if (item.pipelineState.startsWith("deploying") || item.pipelineState.endsWith("_healthy")) return 4;
    if (item.pipelineState === "awaiting_prod_approval") return 5;
    if (item.pipelineState === "complete") return 6;
    if (item.pipelineState === "build_failed" || item.pipelineState === "deploy_failed") return 3;
  }

  switch (item.status) {
    case "backlog": return 0;
    case "todo": return 1;
    case "in_progress": return 2;
    case "in_review": return 5;
    case "done": return 6;
    case "canceled": return 6;
    default: return 0;
  }
}

const STAGE_COLORS = [
  "bg-slate-500/10",
  "bg-blue-500/10",
  "bg-amber-500/10",
  "bg-blue-500/10",
  "bg-purple-500/10",
  "bg-purple-500/10",
  "bg-emerald-500/10",
];

export function PipelineTimeline({ items, className }: PipelineTimelineProps) {
  // Group items by their stage
  const stages: FlowGraphItem[][] = PIPELINE_STAGES.map(() => []);
  for (const item of items) {
    const idx = getStageIndex(item);
    stages[idx]!.push(item);
  }

  return (
    <div className={cn("overflow-x-auto", className)}>
      <div className="grid min-w-[900px] grid-cols-7 gap-2">
        {/* Stage headers */}
        {PIPELINE_STAGES.map((stage, i) => (
          <div key={stage.key} className="px-2 py-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium uppercase tracking-wider text-white/45">
                {stage.label}
              </span>
              <span className="text-[10px] text-white/25">
                {stages[i]!.length}
              </span>
            </div>
          </div>
        ))}

        {/* Stage columns */}
        {PIPELINE_STAGES.map((stage, i) => (
          <div
            key={`col-${stage.key}`}
            className={cn(
              "min-h-[200px] rounded-xl border border-white/5 p-2",
              STAGE_COLORS[i],
            )}
          >
            <div className="space-y-2">
              {stages[i]!.length === 0 ? (
                <div className="py-8 text-center text-[10px] text-white/20">
                  —
                </div>
              ) : (
                stages[i]!.map((item) => (
                  <Link
                    key={item.id}
                    href={`/work-items/${item.id}`}
                    className="block rounded-lg border border-white/8 bg-[#0c1120]/80 px-2.5 py-2 transition hover:border-white/15 hover:bg-[#0c1120]"
                  >
                    <div className="flex items-center gap-1.5">
                      <span className="text-[9px] font-mono text-white/35">
                        {item.identifier}
                      </span>
                      <Badge
                        variant={KIND_COLOR[item.kind] ?? "default"}
                        className="text-[8px] px-1 py-0"
                      >
                        {item.kind}
                      </Badge>
                    </div>
                    <div className="mt-1 text-[11px] font-medium leading-snug text-white/75">
                      {item.title.length > 40
                        ? item.title.slice(0, 37) + "..."
                        : item.title}
                    </div>
                    {item.dispatchAgent && (
                      <div className="mt-1 text-[9px] text-white/25">
                        {item.dispatchAgent}
                      </div>
                    )}
                  </Link>
                ))
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
