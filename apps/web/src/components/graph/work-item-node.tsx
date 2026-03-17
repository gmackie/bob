"use client";

import React, { memo } from "react";
import Link from "next/link";
import { Handle, Position, type NodeProps } from "@xyflow/react";

import { cn } from "@bob/ui";
import { Badge } from "@bob/ui/badge";

import { KIND_COLOR, STATUS_COLOR, PRIORITY_COLOR, formatLabel } from "~/lib/design/colors";

export interface WorkItemNodeData {
  id: string;
  identifier: string;
  title: string;
  status: string;
  kind: string;
  priority?: string;
  childCount?: number;
  dispatchStatus?: string;
  dispatchAgent?: string;
  pipelineState?: string;
}

const PIPELINE_BADGE: Record<string, { color: string; pulse?: boolean }> = {
  agent_complete: { color: "slate" },
  building: { color: "blue", pulse: true },
  gates_passed: { color: "emerald" },
  deploying_dev: { color: "blue", pulse: true },
  dev_healthy: { color: "emerald" },
  deploying_staging: { color: "blue", pulse: true },
  staging_healthy: { color: "emerald" },
  awaiting_prod_approval: { color: "amber" },
  deploying_prod: { color: "blue", pulse: true },
  prod_healthy: { color: "emerald" },
  complete: { color: "emerald" },
  build_failed: { color: "rose" },
  deploy_failed: { color: "rose" },
};

const STATUS_BORDER: Record<string, string> = {
  backlog: "border-l-slate-500/50",
  todo: "border-l-blue-500/50",
  in_progress: "border-l-amber-500",
  in_review: "border-l-purple-500",
  done: "border-l-emerald-500",
  canceled: "border-l-rose-500/50",
};

function WorkItemNodeComponent({ data }: NodeProps) {
  const d = data as unknown as WorkItemNodeData;
  const borderClass = STATUS_BORDER[d.status] ?? "";
  const pipeline = d.pipelineState ? PIPELINE_BADGE[d.pipelineState] : null;

  return (
    <div
      className={cn(
        "min-w-[200px] max-w-[260px] rounded-xl border border-border bg-popover shadow-lg transition-shadow hover:border-muted-foreground/30 hover:shadow-xl",
        borderClass && `border-l-2 ${borderClass}`,
      )}
    >
      <Handle
        type="target"
        position={Position.Top}
        className="!bg-muted-foreground !border-muted-foreground/60 !w-2 !h-2"
      />

      <Link href={`/work-items/${d.id}`} className="block px-3.5 py-3">
        {/* Header: identifier + kind */}
        <div className="flex items-center justify-between gap-2">
          <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
            {d.identifier}
          </span>
          <Badge
            variant={KIND_COLOR[d.kind] ?? "default"}
            className="text-[9px] px-1.5 py-0"
          >
            {d.kind}
          </Badge>
        </div>

        {/* Title */}
        <div className="mt-1.5 text-sm font-medium leading-snug text-foreground">
          {d.title.length > 60 ? d.title.slice(0, 57) + "..." : d.title}
        </div>

        {/* Status + Priority row */}
        <div className="mt-2 flex items-center gap-1.5">
          <Badge
            variant={STATUS_COLOR[d.status] ?? "default"}
            className="text-[9px] px-1.5 py-0"
          >
            {formatLabel(d.status)}
          </Badge>
          {d.priority && d.priority !== "no_priority" && (
            <Badge
              variant={PRIORITY_COLOR[d.priority] ?? "default"}
              className="text-[9px] px-1.5 py-0"
            >
              {formatLabel(d.priority)}
            </Badge>
          )}
        </div>

        {/* Pipeline state */}
        {pipeline && (
          <div className="mt-2 flex items-center gap-1.5">
            <span
              className={cn(
                "size-1.5 rounded-full",
                `bg-${pipeline.color}-400`,
                pipeline.pulse && "animate-pulse",
              )}
            />
            <span className="text-[10px] text-muted-foreground">
              {formatLabel(d.pipelineState!)}
            </span>
            {d.dispatchAgent && (
              <span className="text-[10px] text-muted-foreground">
                ({d.dispatchAgent})
              </span>
            )}
          </div>
        )}

        {/* Child count */}
        {(d.childCount ?? 0) > 0 && (
          <div className="mt-1.5 text-[10px] text-muted-foreground">
            {d.childCount} child item{d.childCount === 1 ? "" : "s"}
          </div>
        )}
      </Link>

      <Handle
        type="source"
        position={Position.Bottom}
        className="!bg-muted-foreground !border-muted-foreground/60 !w-2 !h-2"
      />
    </div>
  );
}

export const WorkItemNode = memo(WorkItemNodeComponent);
