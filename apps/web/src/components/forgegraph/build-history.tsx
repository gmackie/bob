"use client";

import { Badge } from "@bob/ui/badge";

import { BUILD_COLOR, formatLabel } from "~/lib/design/colors";

interface Build {
  id: string;
  status: string;
  duration_ms?: number;
  artifact_url?: string;
  created_at: string;
}

interface BuildHistoryProps {
  builds: Build[];
  available: boolean;
}

export function BuildHistory({ builds, available }: BuildHistoryProps) {
  if (!available) {
    return (
      <div className="rounded-2xl border border-dashed border-white/10 px-4 py-6 text-center text-sm text-white/35">
        Build status unavailable
      </div>
    );
  }

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
            {build.duration_ms != null && (
              <span className="text-xs text-white/40">
                {(build.duration_ms / 1000).toFixed(1)}s
              </span>
            )}
          </div>
          <div className="flex items-center gap-3">
            {build.artifact_url && (
              <a
                href={build.artifact_url}
                target="_blank"
                rel="noreferrer"
                className="text-xs text-blue-400 hover:text-blue-300"
              >
                Artifacts
              </a>
            )}
            <span className="text-xs text-white/30">
              {new Date(build.created_at).toLocaleString()}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}
