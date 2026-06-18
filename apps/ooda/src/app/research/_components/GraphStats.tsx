"use client";

import { useQuery } from "@tanstack/react-query";

import { useTRPC } from "~/trpc/react";

export function GraphStats() {
  const trpc = useTRPC();
  const statsQuery = useQuery(trpc.research.graphStats.queryOptions({}));

  if (statsQuery.isLoading) {
    return <div className="text-xs text-[#5A5855]">Loading graph stats…</div>;
  }
  if (statsQuery.isError) {
    return (
      <div className="text-xs text-red-400">Failed to load graph stats.</div>
    );
  }
  const data = statsQuery.data;
  if (!data) {
    return <div className="text-xs text-[#5A5855]">No graph data yet.</div>;
  }

  const kinds = Object.entries(data.edgesByKind).sort(
    (a, b) => b[1] - a[1],
  );

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3">
        <Counter label="Sources" value={data.totalSources} />
        <Counter label="Nodes" value={data.totalNodes} />
        <Counter label="Edges" value={data.totalEdges} />
      </div>
      <div>
        <div className="mb-2 font-mono text-[10px] uppercase tracking-wider text-[#5A5855]">
          Edges by kind
        </div>
        {kinds.length === 0 ? (
          <div className="text-xs text-[#5A5855]">No edges yet.</div>
        ) : (
          <div className="space-y-1.5">
            {kinds.map(([kind, n]) => (
              <div
                key={kind}
                className="flex items-center justify-between gap-2"
              >
                <span className="font-mono text-[11px] text-[#E8E4DF]">
                  {kind}
                </span>
                <span className="font-mono text-[11px] text-[#D4A04A]">
                  {n.toLocaleString()}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function Counter({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-[4px] border border-[#2A2A2F] bg-[#111113] p-3">
      <div className="font-mono text-[10px] uppercase tracking-wider text-[#5A5855]">
        {label}
      </div>
      <div className="mt-1 font-serif text-xl text-[#E8E4DF]">
        {value.toLocaleString()}
      </div>
    </div>
  );
}
