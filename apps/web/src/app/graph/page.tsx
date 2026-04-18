"use client";

import { useCallback, useMemo } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useRouter } from "next/navigation";
import { useWikiList } from "@/rpc/hooks";

function layoutNodes(
  articles: Array<{
    slug: string;
    title: string;
    tags: string[];
    outboundLinks: string[];
  }>,
) {
  const nodes = articles.map((article, i) => ({
    id: article.slug,
    position: { x: (i % 5) * 250, y: Math.floor(i / 5) * 150 },
    data: { label: article.title, tags: article.tags },
    style: {
      background: "var(--color-bg-secondary)",
      border: "1px solid var(--color-border)",
      borderRadius: "8px",
      padding: "12px",
      color: "var(--color-text)",
      fontSize: "12px",
      fontWeight: 600,
    },
  }));

  const edges = articles.flatMap((article) =>
    article.outboundLinks
      .filter((link) => articles.some((a) => a.slug === link))
      .map((link) => ({
        id: `${article.slug}->${link}`,
        source: article.slug,
        target: link,
        style: { stroke: "var(--color-accent)", strokeWidth: 1.5 },
        animated: true,
      })),
  );

  return { nodes, edges };
}

export default function GraphPage() {
  const router = useRouter();
  const { data: articles } = useWikiList();

  const { initialNodes, initialEdges } = useMemo(() => {
    if (!articles?.length) return { initialNodes: [], initialEdges: [] };
    const { nodes, edges } = layoutNodes(articles);
    return { initialNodes: nodes, initialEdges: edges };
  }, [articles]);

  const [nodes, , onNodesChange] = useNodesState(initialNodes);
  const [edges, , onEdgesChange] = useEdgesState(initialEdges);

  const onNodeClick = useCallback(
    (_: React.MouseEvent, node: { id: string }) => {
      router.push(`/wiki/${node.id}`);
    },
    [router],
  );

  return (
    <div className="h-screen w-screen bg-[var(--color-bg)]">
      <div className="absolute left-4 top-4 z-10 rounded-lg bg-[var(--color-bg-secondary)] border border-[var(--color-border)] px-4 py-2">
        <h1 className="text-sm font-semibold text-[var(--color-text)]">
          Knowledge Graph
        </h1>
        <p className="text-xs text-[var(--color-text-muted)]">
          {nodes.length} articles &middot; {edges.length} connections
        </p>
      </div>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={onNodeClick}
        fitView
        colorMode="dark"
      >
        <Background color="var(--color-border)" gap={20} />
        <Controls />
        <MiniMap
          nodeColor="var(--color-accent)"
          maskColor="rgba(0,0,0,0.7)"
        />
      </ReactFlow>
    </div>
  );
}
