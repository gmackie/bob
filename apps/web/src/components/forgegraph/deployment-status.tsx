"use client";

import { Badge } from "@bob/ui/badge";

import { DEPLOY_COLOR, formatLabel } from "~/lib/design/colors";

interface Deployment {
  id: string;
  environment: string;
  status: string;
  deployedAt?: string | Date | null;
  updatedAt?: string | Date | null;
}

interface DeploymentStatusProps {
  deployments: Deployment[];
}

export function DeploymentStatus({
  deployments,
}: DeploymentStatusProps) {
  if (deployments.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-white/10 px-4 py-6 text-center text-sm text-white/35">
        No deployments yet.
      </div>
    );
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {deployments.map((deploy) => (
        <div
          key={deploy.id}
          className="rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs uppercase tracking-wide text-white/40">
              {deploy.environment}
            </span>
            <Badge variant={DEPLOY_COLOR[deploy.status] ?? "default"}>
              {formatLabel(deploy.status)}
            </Badge>
          </div>
          <div className="mt-1 text-[10px] text-white/25">
            {deploy.deployedAt
              ? new Date(deploy.deployedAt).toLocaleString()
              : formatLabel(deploy.status)}
          </div>
        </div>
      ))}
    </div>
  );
}
