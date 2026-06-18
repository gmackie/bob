// apps/web/src/components/review/gate-row.tsx
"use client";

import { cn } from "@gmacko/core/ui";

export interface Gate {
  name: string;
  status: "pending" | "passed" | "failed" | "running";
  startedAt?: string;
  finishedAt?: string;
}

interface GateRowProps {
  gates: Gate[];
}

const GATE_DOT: Record<string, string> = {
  passed: "border-emerald-500 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  failed: "border-rose-500 bg-rose-500/10 text-rose-600 dark:text-rose-400",
  running: "border-blue-500 bg-blue-500/10 text-blue-600 dark:text-blue-400 animate-pulse",
  pending: "border-border bg-muted text-muted-foreground",
};

const GATE_ICON: Record<string, string> = {
  passed: "✓",
  failed: "✕",
  running: "●",
  pending: "○",
};

function connectorClass(from: string, to: string): string {
  if (from === "passed" && to === "passed") return "bg-emerald-500/40";
  if (from === "passed" && to === "running") return "bg-gradient-to-r from-emerald-500/40 to-blue-500/40";
  if (from === "failed" || to === "failed") return "bg-rose-500/40";
  return "bg-border";
}

function formatDuration(startedAt?: string, finishedAt?: string): string | null {
  if (!startedAt) return null;
  const start = new Date(startedAt).getTime();
  const end = finishedAt ? new Date(finishedAt).getTime() : Date.now();
  const ms = end - start;
  if (ms < 1000) return `${ms}ms`;
  const secs = Math.floor(ms / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  const remSecs = secs % 60;
  return `${mins}m ${remSecs}s`;
}

export function GateRow({ gates }: GateRowProps) {
  if (gates.length === 0) return null;

  return (
    <div className="flex items-center justify-center gap-0 rounded-2xl border border-border bg-card px-6 py-5">
      {gates.map((gate, i) => (
        <div key={gate.name} className="flex items-center">
          {i > 0 && (
            <div
              className={cn(
                "mx-3 h-0.5 w-12",
                connectorClass(gates[i - 1]!.status, gate.status),
              )}
              style={{ marginBottom: 22 }}
            />
          )}
          <div className="flex flex-col items-center gap-1">
            <div
              className={cn(
                "flex h-8 w-8 items-center justify-center rounded-full border-2 text-sm font-bold",
                GATE_DOT[gate.status],
              )}
            >
              {GATE_ICON[gate.status]}
            </div>
            <span className="text-xs font-medium text-secondary-foreground">{gate.name}</span>
            {(gate.startedAt || gate.finishedAt) && (
              <span className="font-mono text-[10px] text-muted-foreground">
                {formatDuration(gate.startedAt, gate.finishedAt)}
              </span>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
