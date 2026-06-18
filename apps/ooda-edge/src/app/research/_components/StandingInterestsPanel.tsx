"use client";

import type { inferRouterOutputs } from "@trpc/server";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import type { EdgeRouter } from "@gmacko/ooda/api";
import { useTRPC } from "~/trpc/react";

type InterestListData = inferRouterOutputs<EdgeRouter>["research"]["interestList"];
type StandingInterest = InterestListData["items"][number];

function formatRelative(ts: Date | string | null): string {
  if (!ts) return "never";
  const then = typeof ts === "string" ? new Date(ts) : ts;
  const diffMs = Date.now() - then.getTime();
  if (diffMs < 0) return "just now";
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function formatCadence(secs: number): string {
  if (secs < 3600) return `${Math.round(secs / 60)}m`;
  if (secs < 86400) return `${Math.round(secs / 3600)}h`;
  return `${Math.round(secs / 86400)}d`;
}

export function StandingInterestsPanel() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  const queryOptions = trpc.research.interestList.queryOptions({});
  const queryKey = queryOptions.queryKey;
  const listQuery = useQuery(queryOptions);

  const updateMutation = useMutation(
    trpc.research.interestUpdate.mutationOptions({
      onMutate: async (vars) => {
        if (vars.enabled === undefined) return { previous: undefined };
        await queryClient.cancelQueries({ queryKey });
        const previous = queryClient.getQueryData<InterestListData>(queryKey);
        if (previous) {
          const nextEnabled = vars.enabled;
          queryClient.setQueryData<InterestListData>(queryKey, {
            items: previous.items.map((item) =>
              item.id === vars.id ? { ...item, enabled: nextEnabled } : item,
            ),
          });
        }
        return { previous };
      },
      onError: (_err, _vars, context) => {
        const prev = (context as { previous?: InterestListData } | undefined)
          ?.previous;
        if (prev) {
          queryClient.setQueryData<InterestListData>(queryKey, prev);
        }
      },
      onSettled: () => {
        void queryClient.invalidateQueries({ queryKey });
      },
    }),
  );

  if (listQuery.isLoading) {
    return <div className="text-xs text-[#5A5855]">Loading interests...</div>;
  }
  if (listQuery.isError) {
    return (
      <div className="text-xs text-red-400">Failed to load interests.</div>
    );
  }
  const items: StandingInterest[] = listQuery.data?.items ?? [];
  if (items.length === 0) {
    return (
      <div className="text-xs text-[#5A5855]">
        No standing interests yet.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {items.map((interest) => (
        <div
          key={interest.id}
          className="flex items-center justify-between gap-3 rounded-[4px] border border-[#2A2A2F] bg-[#111113] p-3"
        >
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm text-[#E8E4DF]">
              {interest.label}
              {interest.threadId === null && (
                <span className="ml-2 rounded-[2px] bg-[#2A2A2F] px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-[#8A8580]">
                  global
                </span>
              )}
            </div>
            <div className="mt-0.5 font-mono text-[10px] text-[#5A5855]">
              every {formatCadence(interest.cadenceSeconds)} &middot; last run{" "}
              {formatRelative(interest.lastRunAt)}
            </div>
          </div>
          <button
            type="button"
            onClick={() =>
              updateMutation.mutate({
                id: interest.id,
                enabled: !interest.enabled,
              })
            }
            disabled={updateMutation.isPending}
            className={[
              "rounded-[3px] border px-2 py-1 font-mono text-[10px]",
              interest.enabled
                ? "border-[#4A9D6B] bg-[#4A9D6B]/10 text-[#4A9D6B]"
                : "border-[#2A2A2F] bg-[#1A1A1E] text-[#5A5855]",
              "disabled:opacity-50",
            ].join(" ")}
          >
            {interest.enabled ? "enabled" : "paused"}
          </button>
        </div>
      ))}
    </div>
  );
}
