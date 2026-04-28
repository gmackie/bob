"use client";

import { useMemo } from "react";
import dagre from "dagre";

interface DraftNode {
  id: string;
  title: string;
  kind: string;
}

interface DraftEdge {
  draftId: string;
  dependsOnDraftId: string;
}

interface DependencyGraphProps {
  drafts: DraftNode[];
  dependencies: DraftEdge[];
}

const NODE_WIDTH = 120;
const NODE_HEIGHT = 36;
const NODE_RADIUS = 8;
const EDGE_STROKE = 1.5;
const ARROW_SIZE = 6;

export function DependencyGraph({ drafts, dependencies }: DependencyGraphProps) {
  const layout = useMemo(() => {
    if (dependencies.length === 0) return null;

    const g = new dagre.graphlib.Graph();
    g.setGraph({
      rankdir: "LR",
      nodesep: 16,
      ranksep: 48,
      marginx: 12,
      marginy: 12,
    });
    g.setDefaultEdgeLabel(() => ({}));

    for (const draft of drafts) {
      g.setNode(draft.id, { width: NODE_WIDTH, height: NODE_HEIGHT });
    }

    for (const dep of dependencies) {
      // Edge direction: dependsOn → draftId (must complete before)
      g.setEdge(dep.dependsOnDraftId, dep.draftId);
    }

    dagre.layout(g);

    const nodes = drafts.map((draft) => {
      const n = g.node(draft.id);
      return {
        ...draft,
        x: n.x - NODE_WIDTH / 2,
        y: n.y - NODE_HEIGHT / 2,
      };
    });

    const edges = dependencies.map((dep) => {
      const edge = g.edge(dep.dependsOnDraftId, dep.draftId);
      return {
        ...dep,
        points: edge.points as Array<{ x: number; y: number }>,
      };
    });

    const graphMeta = g.graph();
    const width = (graphMeta.width ?? 300) + 24;
    const height = (graphMeta.height ?? 100) + 24;

    return { nodes, edges, width, height };
  }, [drafts, dependencies]);

  if (!layout) return null;

  return (
    <div
      className="hidden overflow-x-auto border-b border-border md:block"
      role="img"
      aria-label="Task dependency graph"
    >
      <svg
        width={layout.width}
        height={layout.height}
        className="mx-auto"
      >
        <defs>
          <marker
            id="arrow"
            viewBox={`0 0 ${ARROW_SIZE} ${ARROW_SIZE}`}
            refX={ARROW_SIZE}
            refY={ARROW_SIZE / 2}
            markerWidth={ARROW_SIZE}
            markerHeight={ARROW_SIZE}
            orient="auto-start-reverse"
          >
            <path
              d={`M 0 0 L ${ARROW_SIZE} ${ARROW_SIZE / 2} L 0 ${ARROW_SIZE} Z`}
              className="fill-[#B5B2AB] dark:fill-[#6E6B64]"
            />
          </marker>
        </defs>

        {/* Edges */}
        {layout.edges.map((edge, i) => {
          if (edge.points.length < 2) return null;
          const d = edge.points
            .map((p, j) => `${j === 0 ? "M" : "L"} ${p.x} ${p.y}`)
            .join(" ");
          return (
            <path
              key={i}
              d={d}
              fill="none"
              stroke="#B5B2AB"
              strokeWidth={EDGE_STROKE}
              markerEnd="url(#arrow)"
              className="dark:stroke-[#6E6B64]"
            />
          );
        })}

        {/* Nodes */}
        {layout.nodes.map((node) => {
          const truncTitle =
            node.title.length > 18
              ? `${node.title.slice(0, 16)}...`
              : node.title;
          return (
            <g key={node.id}>
              <rect
                x={node.x}
                y={node.y}
                width={NODE_WIDTH}
                height={NODE_HEIGHT}
                rx={NODE_RADIUS}
                className="fill-[#F5F4F1] stroke-[#E3E1DC] hover:stroke-[#D4850A] dark:fill-[#1C1B18] dark:stroke-[#2E2D2A] dark:hover:stroke-[#E8A33C]"
                strokeWidth={1}
              />
              <text
                x={node.x + NODE_WIDTH / 2}
                y={node.y + NODE_HEIGHT / 2}
                textAnchor="middle"
                dominantBaseline="central"
                className="fill-[#1C1B18] text-[11px] font-medium dark:fill-[#EEEDEA]"
                style={{ fontFamily: "DM Sans, sans-serif" }}
              >
                {truncTitle}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
