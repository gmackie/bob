"use client";

import { lazy, Suspense, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { useTRPC } from "~/trpc/react";

const Reagraph = lazy(() =>
  import("reagraph").then((m) => ({ default: m.GraphCanvas })),
);

interface GraphCanvasProps {
  threadId: string;
}

type NodeKind = "seed" | "reference" | "cites-cited" | "unknown";

// Kind -> color. Muted palette that matches the dashboard's accent (#D4A04A).
const KIND_COLORS: Record<NodeKind, string> = {
  seed: "#D4A04A",
  reference: "#5B8DB0",
  "cites-cited": "#8FB3CE",
  unknown: "#5A5855",
};

interface ReagraphNode {
  id: string;
  label: string;
  fill: string;
  size: number;
  stroke?: string;
  data: {
    sourceId: number;
    title: string | null;
    author: string | null;
    year: number | null;
    influenceScore: number | null;
    s2PaperId: string | null;
    kind: NodeKind;
    inboxFlagged: boolean;
  };
}

interface ReagraphEdge {
  id: string;
  source: string;
  target: string;
  size: number;
  label?: string;
}

// Shapes of `research.graphByThread` / `research.inboxByThread`. Both
// procedures declare `.output(z.any())` (required by trpc-to-openapi), which
// degenerates the client-inferred type, so we re-attach the resolver shapes.
interface GraphNode {
  sourceId: number;
  title: string | null;
  author: string | null;
  year: number | null;
  influenceScore: number | null;
  s2PaperId: string | null;
}
interface GraphEdge {
  fromSourceId: number;
  toSourceId: number;
  kind: string;
  weight: number | null;
}
interface GraphByThreadData {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

// influenceScore varies by orders of magnitude, so log-scale before clamping
// to [4, 24] px -- prevents one high-influence node from dwarfing the canvas.
function sizeForInfluence(influence: number | null): number {
  const n = influence ?? 0;
  return Math.max(4, Math.min(24, Math.log(n + 2) * 4));
}

export function GraphCanvas({ threadId }: GraphCanvasProps) {
  const trpc = useTRPC();
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);

  const graphQuery = useQuery(
    trpc.research.graphByThread.queryOptions({ threadId }),
  );

  // Inbox flag comes from a separate query because graphByThread doesn't
  // expose it; derive the set of flagged sourceIds from pending inbox items.
  const inboxQuery = useQuery(
    trpc.research.inboxByThread.queryOptions({
      threadId,
      triage: "pending",
    }),
  );

  const flaggedSourceIds = useMemo(() => {
    const set = new Set<number>();
    const inboxItems =
      (inboxQuery.data as { items: { sourceId: number }[] } | undefined)
        ?.items ?? [];
    for (const item of inboxItems) {
      set.add(item.sourceId);
    }
    return set;
  }, [inboxQuery.data]);

  const { nodes, edges } = useMemo(() => {
    const raw = graphQuery.data as GraphByThreadData | undefined;
    if (!raw) {
      return {
        nodes: [] as ReagraphNode[],
        edges: [] as ReagraphEdge[],
      };
    }

    // Derive each node's kind from its edge participation:
    // - A node that is the "from" side of a `references` edge is treated as
    //   a seed (it cites others). A node on the "to" side of `references`
    //   is a reference. Anything else (similar_embedding, recommended_by_s2,
    //   cites without references) falls through to "cites-cited".
    const kindBySourceId = new Map<number, NodeKind>();
    for (const e of raw.edges) {
      if (e.kind === "references") {
        if (!kindBySourceId.has(e.fromSourceId)) {
          kindBySourceId.set(e.fromSourceId, "seed");
        }
        const prev = kindBySourceId.get(e.toSourceId);
        if (prev !== "seed") {
          kindBySourceId.set(e.toSourceId, "reference");
        }
      }
    }
    for (const e of raw.edges) {
      for (const sid of [e.fromSourceId, e.toSourceId]) {
        if (!kindBySourceId.has(sid)) {
          kindBySourceId.set(sid, "cites-cited");
        }
      }
    }

    const mappedNodes: ReagraphNode[] = raw.nodes.map((n) => {
      const kind = kindBySourceId.get(n.sourceId) ?? "unknown";
      const flagged = flaggedSourceIds.has(n.sourceId);
      const label =
        n.title ??
        (n.s2PaperId ? `s2:${n.s2PaperId}` : `source:${n.sourceId}`);
      return {
        id: String(n.sourceId),
        label,
        fill: KIND_COLORS[kind],
        size: sizeForInfluence(n.influenceScore),
        // Halo for inbox-flagged papers: Reagraph uses `stroke` on the
        // node for the outline color. Leave undefined when not flagged so
        // the default theme stroke is used.
        ...(flagged ? { stroke: "#E8E4DF" } : {}),
        data: {
          sourceId: n.sourceId,
          title: n.title,
          author: n.author,
          year: n.year,
          influenceScore: n.influenceScore,
          s2PaperId: n.s2PaperId,
          kind,
          inboxFlagged: flagged,
        },
      };
    });

    const mappedEdges: ReagraphEdge[] = raw.edges.map((e, i) => ({
      // Edge primary key in the backend is (from, to, kind); mirror that
      // here so React's key warnings stay silent when kinds collide.
      id: `${e.fromSourceId}-${e.toSourceId}-${e.kind}-${i}`,
      source: String(e.fromSourceId),
      target: String(e.toSourceId),
      size: 1,
      label: e.kind,
    }));

    return { nodes: mappedNodes, edges: mappedEdges };
  }, [graphQuery.data, flaggedSourceIds]);

  const selectedNode = useMemo(() => {
    if (!selectedNodeId) return null;
    return nodes.find((n) => n.id === selectedNodeId) ?? null;
  }, [nodes, selectedNodeId]);

  if (graphQuery.isLoading) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-[#8A8580]">
        loading graph...
      </div>
    );
  }

  if (nodes.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-[#8A8580]">
        no graph data yet -- spawn a dive
      </div>
    );
  }

  return (
    <div className="relative h-full w-full">
      <Suspense
        fallback={
          <div className="flex h-full items-center justify-center text-sm text-[#8A8580]">
            loading graph...
          </div>
        }
      >
        <Reagraph
          nodes={nodes}
          edges={edges}
          onNodeClick={(node) => setSelectedNodeId(node.id)}
          onCanvasClick={() => setSelectedNodeId(null)}
        />
      </Suspense>
      {selectedNode && (
        <NodeDetailPanel
          node={selectedNode}
          onClose={() => setSelectedNodeId(null)}
        />
      )}
    </div>
  );
}

interface NodeDetailPanelProps {
  node: ReagraphNode;
  onClose: () => void;
}

function NodeDetailPanel({ node, onClose }: NodeDetailPanelProps) {
  const { data } = node;
  // For V1.5 we don't have a `papersByIds` procedure yet -- build the CP URL
  // client-side from the s2PaperId when present, otherwise render the
  // button disabled with a tooltip.
  const cpUrl = data.s2PaperId
    ? `https://www.connectedpapers.com/main/${data.s2PaperId}`
    : null;

  return (
    <div
      data-testid="graph-node-detail"
      className="absolute inset-y-0 right-0 z-10 flex w-full flex-col border-l border-[#2A2A2F] bg-[#111113] p-4 sm:w-80"
    >
      <div className="flex items-start justify-between">
        <div className="flex-1 pr-2">
          <h3 className="text-sm font-medium text-[#E8E4DF]">
            {data.title ?? "Untitled"}
          </h3>
          {data.author && (
            <p className="mt-1 text-xs text-[#8A8580]">{data.author}</p>
          )}
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close detail panel"
          className="rounded-[3px] px-1.5 py-0.5 text-xs text-[#8A8580] hover:bg-[#1A1A1E] hover:text-[#E8E4DF]"
        >
          close
        </button>
      </div>

      <dl className="mt-4 space-y-2 text-xs">
        <div className="flex justify-between">
          <dt className="text-[#5A5855]">Year</dt>
          <dd className="text-[#E8E4DF]">{data.year ?? "—"}</dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-[#5A5855]">Influence</dt>
          <dd className="text-[#E8E4DF]">
            {data.influenceScore !== null
              ? data.influenceScore.toFixed(2)
              : "—"}
          </dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-[#5A5855]">Kind</dt>
          <dd className="text-[#E8E4DF]">{data.kind}</dd>
        </div>
        {data.inboxFlagged && (
          <div className="flex justify-between">
            <dt className="text-[#5A5855]">Inbox</dt>
            <dd className="text-[#D4A04A]">flagged</dd>
          </div>
        )}
      </dl>

      <div className="mt-auto pt-4">
        {cpUrl ? (
          <a
            href={cpUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex w-full items-center justify-center rounded-[3px] bg-[#D4A04A]/20 px-3 py-2 text-xs font-medium text-[#D4A04A] transition-colors duration-150 hover:bg-[#D4A04A]/30"
          >
            Open in Connected Papers
          </a>
        ) : (
          <button
            type="button"
            disabled
            title="CP link unavailable"
            className="inline-flex w-full cursor-not-allowed items-center justify-center rounded-[3px] bg-[#1A1A1E] px-3 py-2 text-xs font-medium text-[#5A5855]"
          >
            Open in Connected Papers
          </button>
        )}
      </div>
    </div>
  );
}
