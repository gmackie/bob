"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { Cross1Icon } from "@radix-ui/react-icons";

import { Badge } from "@bob/ui/badge";
import { Button } from "@bob/ui/button";
import { toast } from "@bob/ui/toast";

import { KIND_COLOR, PRIORITY_COLOR, formatLabel } from "~/lib/design/colors";
import { useTRPC } from "~/trpc/react";

interface DraftPanelProps {
  sessionId: string;
  /** When true, renders in expanded mode with full descriptions. */
  expanded?: boolean;
}

export function DraftPanel({ sessionId, expanded = false }: DraftPanelProps) {
  const trpc = useTRPC();
  const router = useRouter();
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    ...trpc.planSession.get.queryOptions({ sessionId }),
    refetchInterval: 5000,
  });

  const removeDraft = useMutation(
    trpc.planSession.removeDraft.mutationOptions({
      onSuccess: () => {
        void queryClient.invalidateQueries({
          queryKey: trpc.planSession.get.queryKey({ sessionId }),
        });
      },
      onError: (err) => {
        toast(err.message, {
          style: { background: "#1a0000", borderColor: "#f43f5e40" },
        });
      },
    }),
  );

  const createBatch = useMutation(
    trpc.dispatch.createBatch.mutationOptions({
      onSuccess: (result) => {
        router.push(`/planning/dispatch/${result.batch.id}`);
      },
      onError: (err) => {
        toast(err.message, {
          style: { background: "#1a0000", borderColor: "#f43f5e40" },
        });
      },
    }),
  );

  const commitPlan = useMutation(
    trpc.planSession.commitPlan.mutationOptions({
      onSuccess: (result) => {
        if (result.committed === 0) {
          toast("No tasks were committed");
          return;
        }
        toast(
          `Committed ${result.committed} task${result.committed === 1 ? "" : "s"} — creating dispatch batch...`,
        );
        void queryClient.invalidateQueries({
          queryKey: trpc.planSession.get.queryKey({ sessionId }),
        });
        createBatch.mutate({ sessionId, tasks: result.tasks });
      },
      onError: (err) => {
        toast(err.message, {
          style: { background: "#1a0000", borderColor: "#f43f5e40" },
        });
      },
    }),
  );

  if (isLoading) {
    return (
      <div className="px-4 py-3 text-sm text-muted-foreground">Loading drafts...</div>
    );
  }

  const drafts = data?.drafts ?? [];
  const dependencies = data?.dependencies ?? [];
  const activeDrafts = drafts.filter((d) => d.status === "draft");

  if (activeDrafts.length === 0) {
    return (
      <div className="px-4 py-3 text-center text-sm text-muted-foreground">
        No draft tasks yet. The planning agent will create them as you discuss.
      </div>
    );
  }

  return (
    <div className={expanded ? "space-y-4" : "space-y-2"}>
      {/* Draft cards */}
      <div className={expanded ? "space-y-3" : "space-y-1.5"}>
        {activeDrafts.map((draft) => {
          const blockedBy = dependencies
            .filter((d) => d.draftId === draft.id)
            .map((d) => {
              const dep = drafts.find((dd) => dd.id === d.dependsOnDraftId);
              return dep?.title ?? "unknown";
            });

          return (
            <div
              key={draft.id}
              className="group rounded-lg border border-border bg-card px-3 py-2.5"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium text-foreground">
                      {draft.title}
                    </span>
                  </div>
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                    <Badge
                      variant={KIND_COLOR[draft.kind] ?? "slate"}
                      className="text-[10px]"
                    >
                      {formatLabel(draft.kind)}
                    </Badge>
                    {draft.priority !== "no_priority" && (
                      <Badge
                        variant={PRIORITY_COLOR[draft.priority] ?? "slate"}
                        className="text-[10px]"
                      >
                        {formatLabel(draft.priority)}
                      </Badge>
                    )}
                  </div>
                  {draft.description && (
                    <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
                      {expanded
                        ? draft.description
                        : draft.description.length > 120
                          ? `${draft.description.slice(0, 120)}...`
                          : draft.description}
                    </p>
                  )}
                  {blockedBy.length > 0 && (
                    <p className="mt-1 text-[10px] text-amber-400/60">
                      blocked by {blockedBy.join(", ")}
                    </p>
                  )}
                </div>
                <button
                  onClick={() => removeDraft.mutate({ id: draft.id })}
                  disabled={removeDraft.isPending}
                  className="shrink-0 rounded p-1 text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-foreground group-hover:opacity-100"
                  title="Remove draft"
                >
                  <Cross1Icon className="size-3" />
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between border-t border-border px-1 pt-2.5">
        <span className="text-xs text-muted-foreground">
          {activeDrafts.length} draft{activeDrafts.length === 1 ? "" : "s"}
        </span>
        <Button
          size="sm"
          onClick={() => commitPlan.mutate({ sessionId })}
          disabled={commitPlan.isPending || createBatch.isPending || activeDrafts.length === 0}
        >
          {commitPlan.isPending ? "Committing..." : "Commit Plan"}
        </Button>
      </div>
    </div>
  );
}
