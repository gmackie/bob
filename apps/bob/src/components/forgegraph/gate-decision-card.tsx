"use client";

import { Badge } from "@gmacko/core/ui/badge";

import { BUILD_COLOR, formatLabel } from "~/lib/design/colors";

interface Gate {
  name: string;
  status: "pending" | "passed" | "failed" | "running";
}

interface GateDecisionCardProps {
  gates: Gate[];
  available: boolean;
}

export function GateDecisionCard({ gates, available }: GateDecisionCardProps) {
  if (!available) {
    return (
      <div className="rounded-2xl border border-dashed border-border px-4 py-4 text-sm text-muted-foreground">
        Gate status unavailable
      </div>
    );
  }

  if (gates.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-border px-4 py-4 text-sm text-muted-foreground">
        No gates configured for this revision.
      </div>
    );
  }

  const nextPending = gates.find((g) => g.status === "pending");
  const allPassed = gates.every((g) => g.status === "passed");
  const hasFailed = gates.some((g) => g.status === "failed");

  return (
    <div className="rounded-2xl border border-border bg-card px-4 py-4">
      <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
        Gate progression
      </div>

      <div className="mt-3 space-y-2">
        {gates.map((gate) => (
          <div
            key={gate.name}
            className="flex items-center justify-between text-sm"
          >
            <span className="text-secondary-foreground">{formatLabel(gate.name)}</span>
            <Badge variant={BUILD_COLOR[gate.status] ?? "default"}>
              {formatLabel(gate.status)}
            </Badge>
          </div>
        ))}
      </div>

      <div className="mt-3 text-xs text-muted-foreground">
        {allPassed
          ? "All gates passed — ready for production."
          : hasFailed
            ? "A gate has failed — check build logs."
            : nextPending
              ? `Next: ${formatLabel(nextPending.name)}`
              : "Gates in progress..."}
      </div>
    </div>
  );
}
