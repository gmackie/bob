// apps/web/src/components/review/environment-lanes.tsx
"use client";

import { cn } from "@gmacko/core/ui";
import { Button } from "@gmacko/core/ui/button";

export interface DeploymentLane {
  id: string;
  environment: string;
  status: string;
  deployedAt: string | null;
  commitSha?: string;
  podReady?: string; // e.g. "2/3"
}

interface EnvironmentLanesProps {
  deployments: DeploymentLane[];
  onApprove?: () => void;
  onRollback?: (deploymentId: string) => void;
  isApproving?: boolean;
}

const ENV_ORDER = ["dev", "staging", "prod", "production"];

const TOP_BAR_COLOR: Record<string, string> = {
  healthy: "bg-emerald-500",
  deploying: "bg-amber-500",
  unhealthy: "bg-rose-500",
  failed: "bg-rose-500",
  pending_approval: "bg-purple-500",
  rolled_back: "bg-rose-500",
  pending: "bg-border",
};

const STATUS_DOT: Record<string, string> = {
  healthy: "bg-emerald-500",
  deploying: "bg-amber-500 animate-pulse",
  unhealthy: "bg-rose-500",
  failed: "bg-rose-500",
  pending_approval: "bg-purple-500",
  rolled_back: "bg-rose-500/50",
  pending: "bg-muted-foreground/30",
};

const STATUS_TEXT_COLOR: Record<string, string> = {
  healthy: "text-emerald-600 dark:text-emerald-400",
  deploying: "text-amber-600 dark:text-amber-400",
  unhealthy: "text-rose-600 dark:text-rose-400",
  failed: "text-rose-600 dark:text-rose-400",
  pending_approval: "text-purple-600 dark:text-purple-400",
};

function formatLabel(s: string): string {
  return s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatTimeAgo(date: string): string {
  const d = new Date(date);
  const diffMs = Date.now() - d.getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export function EnvironmentLanes({ deployments, onApprove, onRollback, isApproving }: EnvironmentLanesProps) {
  const sorted = [...deployments].sort(
    (a, b) => ENV_ORDER.indexOf(a.environment) - ENV_ORDER.indexOf(b.environment),
  );

  if (sorted.length === 0) return null;

  return (
    <section id="section-deploy">
      <div className="grid gap-0 overflow-hidden rounded-2xl border border-border sm:grid-cols-3">
        {sorted.map((deploy, i) => (
          <div
            key={deploy.id}
            className={cn(
              "relative bg-card px-5 py-5",
              i > 0 && "border-t sm:border-l sm:border-t-0 border-border",
            )}
          >
            {/* Top color bar */}
            <div className={cn("absolute inset-x-0 top-0 h-[3px]", TOP_BAR_COLOR[deploy.status] ?? "bg-border")} />

            <div className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
              {deploy.environment === "prod" ? "Production" : formatLabel(deploy.environment)}
            </div>

            <div className="mt-2 flex items-center gap-2">
              <div className={cn("h-2 w-2 shrink-0 rounded-full", STATUS_DOT[deploy.status] ?? "bg-muted-foreground/30")} />
              <span className={cn("text-sm font-semibold", STATUS_TEXT_COLOR[deploy.status] ?? "text-muted-foreground")}>
                {formatLabel(deploy.status)}
              </span>
            </div>

            {deploy.podReady && (
              <div className="mt-1 text-xs text-muted-foreground">{deploy.podReady} pods ready</div>
            )}

            {deploy.deployedAt && (
              <div className="mt-1 text-xs text-muted-foreground">
                Deployed {formatTimeAgo(deploy.deployedAt)}
              </div>
            )}

            {deploy.commitSha && (
              <div className="mt-2">
                <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                  {deploy.commitSha.slice(0, 7)}
                </span>
              </div>
            )}

            {/* Deploying progress */}
            {deploy.status === "deploying" && (
              <div className="mt-3">
                <div className="h-1 rounded-full bg-muted">
                  <div className="h-1 w-2/3 animate-pulse rounded-full bg-amber-500" />
                </div>
              </div>
            )}

            {/* Rollback button */}
            {(deploy.status === "unhealthy" || deploy.status === "failed") && onRollback && (
              <div className="mt-3 flex gap-2">
                <Button
                  size="sm"
                  variant="destructive"
                  className="h-7 text-xs"
                  onClick={() => onRollback(deploy.id)}
                >
                  ↩ Rollback
                </Button>
              </div>
            )}

            {/* Promote button on prod lane */}
            {deploy.status === "pending_approval" && onApprove && (
              <div className="mt-3">
                <Button
                  size="sm"
                  className="h-7 w-full bg-emerald-600 text-xs text-white hover:bg-emerald-700"
                  onClick={onApprove}
                  disabled={isApproving}
                >
                  {isApproving ? "Approving..." : "✓ Approve Production"}
                </Button>
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
