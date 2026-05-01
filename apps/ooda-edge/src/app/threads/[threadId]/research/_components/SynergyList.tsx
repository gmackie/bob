"use client";

import { useQuery } from "@tanstack/react-query";

import { useTRPC } from "~/trpc/react";

interface SynergyListProps {
  threadId: string;
}

const KIND_LABEL: Record<string, string> = {
  topic_overlap: "topic",
  citation_overlap: "cites",
  question_answered: "answers",
  supersedes: "supersedes",
};

export function SynergyList({ threadId }: SynergyListProps) {
  const trpc = useTRPC();
  const linksQuery = useQuery(
    trpc.research.linksByThread.queryOptions({ threadId, limit: 20 }),
  );

  if (linksQuery.isLoading) {
    return <div className="p-3 text-xs text-[#5A5855]">Loading synergies...</div>;
  }
  if (linksQuery.isError) {
    return (
      <div className="p-3 text-xs text-red-400">Failed to load synergies.</div>
    );
  }
  const items = linksQuery.data?.items ?? [];
  if (items.length === 0) {
    return (
      <div className="p-3 text-xs text-[#5A5855]">No cross-thread links.</div>
    );
  }

  return (
    <div className="space-y-2">
      {items.map((item, idx) => (
        <div
          key={`${item.otherThreadId}-${item.kind}-${idx}`}
          className="rounded-[4px] border border-[#2A2A2F] bg-[#1A1A1E] p-3"
        >
          <div className="mb-1 flex items-center justify-between gap-2">
            <div className="min-w-0 flex-1 truncate text-sm text-[#E8E4DF]">
              {item.otherThreadTitle ?? item.otherThreadId}
            </div>
            <span className="rounded-[2px] bg-[#D4A04A]/10 px-1.5 py-0.5 font-mono text-[10px] text-[#D4A04A]">
              {KIND_LABEL[item.kind] ?? item.kind}
            </span>
          </div>
          <div className="flex items-center gap-2 font-mono text-[10px] text-[#5A5855]">
            {item.score !== null && <span>score {item.score.toFixed(2)}</span>}
            {item.discoveredAt && (
              <span>
                {new Date(item.discoveredAt).toLocaleDateString()}
              </span>
            )}
          </div>
          {item.reasonMd && (
            <p className="mt-1.5 line-clamp-2 text-xs text-[#9A9590]">
              {item.reasonMd}
            </p>
          )}
        </div>
      ))}
    </div>
  );
}
