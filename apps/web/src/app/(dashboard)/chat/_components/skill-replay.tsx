"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { cn } from "@bob/ui";
import { useTRPC } from "~/trpc/react";

interface SkillReplayProps {
  executionId: string;
  onClose: () => void;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remaining = seconds % 60;
  return remaining > 0 ? `${minutes}m ${remaining}s` : `${minutes}m`;
}

function statusColor(status: string): string {
  switch (status) {
    case "completed":
      return "bg-emerald-500";
    case "failed":
      return "bg-rose-500";
    case "running":
      return "bg-blue-500 animate-pulse";
    case "cancelled":
      return "bg-slate-400";
    default:
      return "bg-muted-foreground";
  }
}

export function SkillReplay({ executionId, onClose }: SkillReplayProps) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const [editMode, setEditMode] = useState(false);
  const [editedInput, setEditedInput] = useState("");

  const { data: execution, isLoading } = useQuery({
    ...trpc.skill.getExecution.queryOptions({ id: executionId }),
  });

  const rerunMutation = useMutation(
    trpc.skill.recordExecution.mutationOptions({
      onSuccess: () => {
        void queryClient.invalidateQueries({
          queryKey: trpc.skill.getExecution.queryKey({ id: executionId }),
        });
        setEditMode(false);
      },
    }),
  );

  if (isLoading) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
        <div className="w-full max-w-lg rounded-xl border border-border bg-card p-6">
          <div className="space-y-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="h-4 animate-pulse rounded bg-muted/50" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (!execution) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
        <div className="w-full max-w-lg rounded-xl border border-border bg-card p-6">
          <p className="text-sm text-muted-foreground">Execution not found</p>
          <button
            type="button"
            onClick={onClose}
            className="mt-3 text-sm text-primary hover:underline"
          >
            Close
          </button>
        </div>
      </div>
    );
  }

  const inputData = execution.input as Record<string, unknown> | undefined;
  const outputData = execution.output as Record<string, unknown> | undefined;
  const findings = execution.findings as Array<{
    type: string;
    severity: string;
    message: string;
    durationMs?: number;
  }> | undefined;

  function handleEditRerun() {
    if (!execution) return;

    if (!editMode) {
      setEditedInput(JSON.stringify(inputData ?? {}, null, 2));
      setEditMode(true);
      return;
    }

    try {
      const parsedInput = JSON.parse(editedInput) as Record<string, unknown>;
      rerunMutation.mutate({
        skillSlug: execution.skillSlug,
        skillId: execution.skillId ?? undefined,
        sessionId: execution.sessionId ?? undefined,
        workItemId: execution.workItemId ?? undefined,
        parentExecutionId: execution.id,
        input: parsedInput,
      });
    } catch {
      // Invalid JSON, ignore
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-lg rounded-xl border border-border bg-card shadow-lg">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <div className="flex items-center gap-2">
            <span className="font-mono text-sm font-semibold text-foreground">
              /{execution.skillSlug}
            </span>
            {execution.skillName && (
              <span className="text-sm text-muted-foreground">
                {execution.skillName}
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground transition-colors text-lg leading-none"
          >
            &times;
          </button>
        </div>

        {/* Body */}
        <div className="max-h-[60vh] overflow-y-auto p-5 space-y-4">
          {/* Status overview */}
          <div className="flex items-center gap-3">
            <span
              className={cn(
                "inline-block size-2.5 rounded-full",
                statusColor(execution.status),
              )}
            />
            <span className="text-sm font-medium text-foreground capitalize">
              {execution.status}
            </span>
            {execution.durationMs != null && (
              <span className="text-sm text-muted-foreground tabular-nums">
                {formatDuration(execution.durationMs)}
              </span>
            )}
          </div>

          {/* Timeline of findings as sub-steps */}
          {findings && findings.length > 0 && (
            <div className="space-y-1">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Steps
              </h4>
              <div className="space-y-1.5">
                {findings.map((finding, i) => (
                  <div
                    key={i}
                    className="flex items-center gap-2 rounded-lg border border-border px-3 py-2"
                  >
                    <span
                      className={cn(
                        "size-1.5 rounded-full shrink-0",
                        finding.severity === "pass" || finding.severity === "ok"
                          ? "bg-emerald-500"
                          : finding.severity === "error" ||
                              finding.severity === "fail"
                            ? "bg-rose-500"
                            : finding.severity === "warning"
                              ? "bg-amber-500"
                              : "bg-muted-foreground",
                      )}
                    />
                    <span className="flex-1 text-sm text-foreground">
                      <span className="font-medium">{finding.type}</span>
                      {": "}
                      {finding.message}
                    </span>
                    {finding.durationMs != null && (
                      <span className="text-xs text-muted-foreground tabular-nums shrink-0">
                        {formatDuration(finding.durationMs)}
                      </span>
                    )}
                    {/* Duration bar */}
                    {finding.durationMs != null && execution.durationMs != null && execution.durationMs > 0 && (
                      <div className="w-16 h-1.5 rounded-full bg-muted overflow-hidden shrink-0">
                        <div
                          className="h-full rounded-full bg-primary"
                          style={{
                            width: `${Math.min(100, (finding.durationMs / execution.durationMs) * 100)}%`,
                          }}
                        />
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Output */}
          {outputData && Object.keys(outputData).length > 0 && (
            <div className="space-y-1">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Output
              </h4>
              <pre className="rounded-lg bg-muted/50 p-3 text-xs font-mono text-foreground overflow-x-auto">
                {JSON.stringify(outputData, null, 2)}
              </pre>
            </div>
          )}

          {/* Edit & Re-run */}
          {editMode && (
            <div className="space-y-2">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Edit Input
              </h4>
              <textarea
                value={editedInput}
                onChange={(e) => setEditedInput(e.target.value)}
                className="w-full rounded-lg border border-border bg-background p-3 font-mono text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                rows={6}
              />
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-3">
          {editMode && (
            <button
              type="button"
              onClick={() => setEditMode(false)}
              className="rounded-lg px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              Cancel
            </button>
          )}
          <button
            type="button"
            onClick={handleEditRerun}
            disabled={rerunMutation.isPending}
            className={cn(
              "rounded-lg px-4 py-1.5 text-sm font-medium transition-colors",
              "bg-primary text-primary-foreground hover:bg-primary/90",
              "disabled:opacity-50 disabled:cursor-not-allowed",
            )}
          >
            {rerunMutation.isPending
              ? "Running..."
              : editMode
                ? "Re-run"
                : "Edit & Re-run"}
          </button>
        </div>
      </div>
    </div>
  );
}
