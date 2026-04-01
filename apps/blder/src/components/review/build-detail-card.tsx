// apps/web/src/components/review/build-detail-card.tsx
"use client";

import { cn } from "@bob/ui";
import { Badge } from "@bob/ui/badge";
import { BUILD_COLOR, formatLabel } from "~/lib/design/colors";

export interface BuildData {
  id: string;
  status: string;
  ciProvider: string | null;
  externalJobId: string | null;
  imageDigest: string | null;
  durationMs: number | null;
  commitSha?: string;
  createdAt: Date | string;
}

interface BuildDetailCardProps {
  build: BuildData;
  artifacts?: Array<{ type: string; label: string; icon: string; onClick?: () => void }>;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const secs = Math.floor(ms / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  const remSecs = secs % 60;
  return `${mins}m ${remSecs}s`;
}

function formatTimeAgo(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  const diffMs = Date.now() - d.getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export function BuildDetailCard({ build, artifacts }: BuildDetailCardProps) {
  const isPassed = build.status === "passed";
  const isFailed = build.status === "failed";

  return (
    <div className={cn(
      "flex items-start gap-3.5 rounded-2xl border bg-card px-5 py-4",
      isFailed ? "border-rose-500/30" : "border-border",
    )}>
      <div className={cn(
        "flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-xl",
        isPassed ? "bg-emerald-500/10" : isFailed ? "bg-rose-500/10" : "bg-muted",
      )}>
        {"\uD83C\uDFD7"}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-foreground">
            Build #{build.id.slice(0, 6)}
          </span>
          <Badge variant={BUILD_COLOR[build.status] ?? "default"} className="text-[10px]">
            {formatLabel(build.status)}
          </Badge>
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
          {build.commitSha && (
            <span className="font-mono">{build.commitSha.slice(0, 7)}</span>
          )}
          {build.ciProvider && (
            <>
              <span className="text-border">·</span>
              <span>{build.ciProvider}</span>
            </>
          )}
          {build.durationMs !== null && (
            <>
              <span className="text-border">·</span>
              <span>Duration: {formatDuration(build.durationMs)}</span>
            </>
          )}
          <span className="text-border">·</span>
          <span>{formatTimeAgo(build.createdAt)}</span>
        </div>
        {build.imageDigest && (
          <div className="mt-1 text-xs text-muted-foreground">
            Image: <span className="font-mono">{build.imageDigest.slice(0, 19)}...</span>
          </div>
        )}
        {artifacts && artifacts.length > 0 && (
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            {artifacts.map((a) => (
              <button
                key={a.type}
                type="button"
                onClick={a.onClick}
                className="flex items-center gap-1.5 rounded-md border border-border bg-muted/50 px-2.5 py-1 text-[11px] font-medium text-secondary-foreground transition-colors hover:border-primary/30 hover:bg-primary/5 hover:text-primary"
              >
                <span className="text-xs">{a.icon}</span>
                {a.label}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
