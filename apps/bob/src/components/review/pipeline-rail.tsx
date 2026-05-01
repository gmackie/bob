// apps/web/src/components/review/pipeline-rail.tsx
"use client";

import { cn } from "@gmacko/core/ui";

export type PipelineNodeStatus = "done" | "active" | "failed" | "pending" | "approval";

export interface PipelineNode {
  name: string;
  status: PipelineNodeStatus;
  elapsed?: string;
  detail?: string;
  anchorId?: string;
}

interface PipelineRailProps {
  nodes: PipelineNode[];
}

const STATUS_DOT: Record<PipelineNodeStatus, string> = {
  done: "bg-emerald-500 text-white",
  active: "bg-amber-500 text-white animate-pulse",
  failed: "bg-rose-500 text-white",
  pending: "bg-muted border-2 border-border text-muted-foreground",
  approval: "bg-purple-500 text-white",
};

const STATUS_ICON: Record<PipelineNodeStatus, string> = {
  done: "✓",
  active: "●",
  failed: "✕",
  pending: "",
  approval: "⏸",
};

const LABEL_COLOR: Record<PipelineNodeStatus, string> = {
  done: "text-emerald-600 dark:text-emerald-400",
  active: "text-amber-600 dark:text-amber-400 font-semibold",
  failed: "text-rose-600 dark:text-rose-400",
  pending: "text-muted-foreground",
  approval: "text-purple-600 dark:text-purple-400 font-semibold",
};

function connectorColor(from: PipelineNodeStatus, to: PipelineNodeStatus): string {
  if (from === "done" && to === "done") return "bg-emerald-500";
  if (from === "done" && (to === "active" || to === "approval")) return "bg-gradient-to-r from-emerald-500 to-amber-500";
  if (from === "failed" || to === "failed") return "bg-rose-500";
  return "bg-border";
}

export function PipelineRail({ nodes }: PipelineRailProps) {
  return (
    <div className="sticky top-0 z-30 flex items-center gap-0 overflow-x-auto border-b border-border bg-card px-6 py-5">
      {nodes.map((node, i) => (
        <div key={node.name} className="flex items-center">
          {i > 0 && (
            <div
              className={cn(
                "mx-1 h-0.5 w-8 shrink-0",
                connectorColor(nodes[i - 1]!.status, node.status),
              )}
              style={{ marginBottom: 22 }}
            />
          )}
          <a
            href={node.anchorId ? `#${node.anchorId}` : undefined}
            className="flex min-w-[80px] flex-col items-center gap-1"
          >
            <div
              className={cn(
                "flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold",
                STATUS_DOT[node.status],
              )}
            >
              {STATUS_ICON[node.status]}
            </div>
            <span className={cn("text-[10px] font-medium", LABEL_COLOR[node.status])}>
              {node.name}
            </span>
            {node.elapsed && (
              <span className="font-mono text-[9px] text-muted-foreground">{node.elapsed}</span>
            )}
          </a>
        </div>
      ))}
    </div>
  );
}
