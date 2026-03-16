"use client";

import { Badge } from "@bob/ui/badge";

import { DEPLOY_COLOR, formatLabel } from "~/lib/design/colors";

interface Deployment {
  id: string;
  environment: string;
  status: string;
  revision_sha?: string;
  deployed_at?: string;
  updated_at: string;
}

interface DeploymentStatusProps {
  deployments: Deployment[];
  available: boolean;
}

export function DeploymentStatus({
  deployments,
  available,
}: DeploymentStatusProps) {
  if (!available) {
    return (
      <div className="rounded-2xl border border-dashed border-white/10 px-4 py-6 text-center text-sm text-white/35">
        Deployment status unavailable
      </div>
    );
  }

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
          {deploy.revision_sha && (
            <div className="mt-2 font-mono text-xs text-white/40">
              {deploy.revision_sha.slice(0, 8)}
            </div>
          )}
          <div className="mt-1 text-[10px] text-white/25">
            {deploy.deployed_at
              ? new Date(deploy.deployed_at).toLocaleString()
              : formatLabel(deploy.status)}
          </div>
        </div>
      ))}
    </div>
  );
}
