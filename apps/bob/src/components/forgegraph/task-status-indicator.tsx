"use client";

import { cn } from "@gmacko/core/ui";

interface TaskStatusIndicatorProps {
  buildStatus?: "queued" | "running" | "passed" | "failed" | "canceled";
  deployStatus?:
    | "pending"
    | "deploying"
    | "healthy"
    | "unhealthy"
    | "rolled_back";
}

const BUILD_DOT: Record<string, string> = {
  queued: "bg-slate-400",
  running: "bg-blue-400 animate-pulse",
  passed: "bg-emerald-400",
  failed: "bg-rose-400",
  canceled: "bg-slate-400",
};

const DEPLOY_DOT: Record<string, string> = {
  pending: "bg-amber-400",
  deploying: "bg-blue-400 animate-pulse",
  healthy: "bg-emerald-400",
  unhealthy: "bg-rose-400",
  rolled_back: "bg-slate-400",
};

export function TaskStatusIndicator({
  buildStatus,
  deployStatus,
}: TaskStatusIndicatorProps) {
  if (!buildStatus && !deployStatus) return null;

  return (
    <div className="flex items-center gap-1">
      {buildStatus && (
        <span
          className={cn("size-2 rounded-full", BUILD_DOT[buildStatus])}
          title={`Build: ${buildStatus}`}
        />
      )}
      {deployStatus && (
        <span
          className={cn("size-2 rounded-full", DEPLOY_DOT[deployStatus])}
          title={`Deploy: ${deployStatus}`}
        />
      )}
    </div>
  );
}
