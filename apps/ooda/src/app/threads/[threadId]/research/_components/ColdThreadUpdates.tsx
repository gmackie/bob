"use client";

import { useMutation, useQuery } from "@tanstack/react-query";

import { useTRPC } from "~/trpc/react";

interface ColdThreadUpdatesProps {
  threadId: string;
}

export function ColdThreadUpdates({ threadId }: ColdThreadUpdatesProps) {
  const trpc = useTRPC();
  const updatesQuery = useQuery(
    trpc.research.coldThreadUpdatesByThread.queryOptions({ threadId }),
  );
  const diveMutation = useMutation(trpc.research.diveSpawn.mutationOptions());

  if (updatesQuery.isLoading) {
    return (
      <div className="p-3 text-xs text-[#5A5855]">
        Checking for updates on cold threads…
      </div>
    );
  }
  if (updatesQuery.isError) {
    return (
      <div className="p-3 text-xs text-red-400">
        Failed to load cold-thread updates.
      </div>
    );
  }
  const items = updatesQuery.data?.items ?? [];
  if (items.length === 0) {
    return (
      <div className="p-3 text-xs text-[#5A5855]">
        No updates for cold threads.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {items.map((item) => (
        <div
          key={item.sourceId}
          className="rounded-[4px] border border-[#2A2A2F] bg-[#1A1A1E] p-3"
        >
          <div className="mb-1 flex items-start justify-between gap-2">
            <div className="min-w-0 flex-1 truncate text-sm text-[#E8E4DF]">
              {item.title || "(untitled)"}
            </div>
            <span className="shrink-0 font-mono text-[10px] text-[#5A5855]">
              {item.foundAt ? new Date(item.foundAt).toLocaleDateString() : ""}
            </span>
          </div>
          {item.reasonMd && (
            <p className="mb-2 line-clamp-2 text-xs text-[#9A9590]">
              {item.reasonMd}
            </p>
          )}
          <button
            type="button"
            disabled={diveMutation.isPending}
            onClick={() =>
              diveMutation.mutate({
                threadId,
                seeds: [String(item.sourceId)],
              })
            }
            className="rounded-[3px] border border-[#2A2A2F] bg-[#D4A04A]/10 px-2 py-1 font-mono text-[10px] text-[#D4A04A] hover:bg-[#D4A04A]/20 disabled:opacity-50"
          >
            {diveMutation.isPending ? "Spawning…" : "Spawn dive"}
          </button>
        </div>
      ))}
    </div>
  );
}
