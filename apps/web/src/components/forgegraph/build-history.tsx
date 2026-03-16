"use client";

import { Badge } from "@bob/ui/badge";

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
      <div className="rounded-2xl border border-dashed border-white/10 px-4 py-6 text-center text-sm text-white/35">
        No builds yet.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {builds.map((build) => (
        <div
          key={build.id}
          className="flex items-center justify-between rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3"
        >
          <div className="flex items-center gap-3">
            <Badge variant={BUILD_COLOR[build.status] ?? "default"}>
              {formatLabel(build.status)}
            </Badge>
            {build.durationMs != null && (
              <span className="text-xs text-white/40">
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
            <span className="text-xs text-white/30">
              {new Date(build.createdAt).toLocaleString()}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}
