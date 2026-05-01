"use client";

import { Badge } from "@gmacko/core/ui/badge";

import { BUILD_COLOR, formatLabel } from "~/lib/design/colors";

interface Build {
  id: string;
  status: string;
  durationMs?: number | null;
  artifactManifestRef?: string | null;
  createdAt: string | Date;
}

interface BuildHistoryProps {
  builds: Build[];
}

export function BuildHistory({ builds }: BuildHistoryProps) {
  if (builds.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
        No builds yet.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {builds.map((build) => (
        <div
          key={build.id}
          className="flex items-center justify-between rounded-xl border border-border bg-card px-4 py-3"
        >
          <div className="flex items-center gap-3">
            <Badge variant={BUILD_COLOR[build.status] ?? "default"}>
              {formatLabel(build.status)}
            </Badge>
            {build.durationMs != null && (
              <span className="text-xs text-muted-foreground">
                {(build.durationMs / 1000).toFixed(1)}s
              </span>
            )}
          </div>
          <div className="flex items-center gap-3">
            {build.artifactManifestRef && (
              <span className="text-xs text-blue-400">
                {build.artifactManifestRef}
              </span>
            )}
            <span className="text-xs text-muted-foreground">
              {new Date(build.createdAt).toLocaleString()}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}
