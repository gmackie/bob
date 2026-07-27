"use client";

import { useQuery } from "@tanstack/react-query";

import { useTRPC } from "~/trpc/react";

// `research.graphStats` is `.output(z.any())` for OpenAPI, which degenerates
// the client query type; mirror the aggregate shape the resolver returns.
interface GraphStatsData {
  totalNodes: number;
  totalEdges: number;
  totalSources: number;
  edgesByKind: Record<string, number>;
}

export function GraphStats() {
  const trpc = useTRPC();
  const statsQuery = useQuery(trpc.research.graphStats.queryOptions({}));

  if (statsQuery.isLoading) {
    return <div className="text-xs text-subtle">Loading graph stats…</div>;
  }
  if (statsQuery.isError) {
    return (
      <div className="text-xs text-red-400">Failed to load graph stats.</div>
    );
  }
  const data = statsQuery.data as unknown as GraphStatsData | undefined;
  if (!data) {
    return <div className="text-xs text-subtle">No graph data yet.</div>;
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
        <div className="mb-2 font-mono text-[10px] uppercase tracking-wider text-subtle">
          Edges by kind
        </div>
        {kinds.length === 0 ? (
          <div className="text-xs text-subtle">No edges yet.</div>
        ) : (
          <div className="space-y-1.5">
            {kinds.map(([kind, n]) => (
              <div
                key={kind}
                className="flex items-center justify-between gap-2"
              >
                <span className="font-mono text-[11px] text-foreground">
                  {kind}
                </span>
                <span className="font-mono text-[11px] text-primary">
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
    <div className="rounded-[4px] border border-border bg-background p-3">
      <div className="font-mono text-[10px] uppercase tracking-wider text-subtle">
        {label}
      </div>
      <div className="mt-1 font-serif text-xl text-foreground">
        {value.toLocaleString()}
      </div>
    </div>
  );
}
