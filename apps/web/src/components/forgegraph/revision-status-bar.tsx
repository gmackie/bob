"use client";

import { cn } from "@bob/ui";
import { Badge } from "@bob/ui/badge";

import { BUILD_COLOR, formatLabel } from "~/lib/design/colors";

interface Gate {
  name: string;
  status: "pending" | "passed" | "failed" | "running";
}

interface RevisionStatusBarProps {
  gates: Gate[];
  commitSha?: string;
  branch?: string;
}

export function RevisionStatusBar({
  gates,
  commitSha,
  branch,
}: RevisionStatusBarProps) {
  if (gates.length === 0) {
    return (
      <div className="text-sm text-white/35">No gates configured.</div>
    );
  }

  return (
    <div>
      {(commitSha || branch) && (
        <div className="mb-3 flex items-center gap-2 text-xs text-white/40">
          {branch && <span className="font-mono">{branch}</span>}
          {commitSha && (
            <span className="font-mono">{commitSha.slice(0, 8)}</span>
          )}
        </div>
      )}
      <div className="flex items-center gap-1">
        {gates.map((gate, i) => (
          <div key={gate.name} className="flex items-center">
            {i > 0 && (
              <div
                className={cn(
                  "mx-1 h-0.5 w-4",
                  gate.status === "passed"
                    ? "bg-emerald-500/40"
                    : gate.status === "failed"
                      ? "bg-rose-500/40"
                      : "bg-white/10",
                )}
              />
            )}
            <Badge
              variant={BUILD_COLOR[gate.status] ?? "default"}
              className="text-[10px]"
            >
              {formatLabel(gate.name)}
            </Badge>
          </div>
        ))}
      </div>
    </div>
  );
}
