// apps/web/src/components/review/error-detail-card.tsx
"use client";

import { cn } from "@bob/ui";
import { Button } from "@bob/ui/button";

export interface ErrorDetailCardProps {
  type: "build_failed" | "deploy_failed" | "review_failed";
  title: string;
  message: string;
  stackTrace?: string;
  onRetry?: () => void;
  onResumeAgent?: () => void;
  onRollback?: () => void;
  onViewLogs?: () => void;
  isRetrying?: boolean;
}

const TYPE_CONFIG: Record<string, { icon: string; label: string }> = {
  build_failed: { icon: "🔴", label: "Build Failed" },
  deploy_failed: { icon: "🚨", label: "Deploy Failed" },
  review_failed: { icon: "🔄", label: "Review Rejected" },
};

export function ErrorDetailCard({
  type,
  title,
  message,
  stackTrace,
  onRetry,
  onResumeAgent,
  onRollback,
  onViewLogs,
  isRetrying,
}: ErrorDetailCardProps) {
  const config = TYPE_CONFIG[type] ?? TYPE_CONFIG.build_failed!;

  return (
    <div className="rounded-2xl border border-rose-500/30 bg-rose-500/5 dark:bg-rose-500/10 px-5 py-4">
      <div className="flex items-start gap-3.5">
        <span className="text-xl">{config.icon}</span>
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-rose-700 dark:text-rose-400">{title}</div>
          <div className="mt-1 text-sm text-secondary-foreground">{message}</div>

          {stackTrace && (
            <div className="mt-3 overflow-x-auto rounded-lg bg-rose-950/10 dark:bg-black/20 px-3 py-2 font-mono text-[11px] leading-relaxed text-rose-700 dark:text-rose-300 whitespace-pre">
              {stackTrace}
            </div>
          )}

          <div className="mt-4 flex flex-wrap gap-2">
            {onRetry && (
              <Button size="sm" variant="outline" className="h-7 text-xs" onClick={onRetry} disabled={isRetrying}>
                {isRetrying ? "Retrying..." : "↻ Retry"}
              </Button>
            )}
            {onResumeAgent && (
              <Button size="sm" variant="outline" className="h-7 text-xs" onClick={onResumeAgent}>
                Resume Agent
              </Button>
            )}
            {onRollback && (
              <Button size="sm" variant="destructive" className="h-7 text-xs" onClick={onRollback}>
                ↩ Rollback
              </Button>
            )}
            {onViewLogs && (
              <Button size="sm" variant="outline" className="h-7 text-xs" onClick={onViewLogs}>
                📋 View Logs
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
