"use client";

import React, { useCallback, useMemo } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  type Node,
  type Edge,
  type ColorMode,
  MarkerType,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import { WorkItemNode, type WorkItemNodeData } from "./work-item-node";
import { layoutGraph } from "./auto-layout";

const nodeTypes = {
  workItem: WorkItemNode,
};

export interface FlowGraphItem {
  id: string;
  identifier: string;
  title: string;
  status: string;
  kind: string;
  priority?: string;
  parentId?: string | null;
  childCount?: number;
  dispatchStatus?: string;
  dispatchAgent?: string;
  pipelineState?: string;
}

interface FlowGraphProps {
  items: FlowGraphItem[];
  /** Additional dependency edges (e.g., from dispatch blocking) */
  dependencies?: Array<{ from: string; to: string }>;
  direction?: "TB" | "LR";
  className?: string;
}

const EDGE_STYLE_PARENT = {
  stroke: "rgba(255,255,255,0.15)",
  strokeWidth: 1.5,
};

const EDGE_STYLE_DEPENDENCY = {
  stroke: "rgba(59,130,246,0.4)",
  strokeWidth: 1.5,
  strokeDasharray: "5 3",
};

export function FlowGraph({
  items,
  dependencies = [],
  direction = "TB",
  className,
}: FlowGraphProps) {
  const { initialNodes, initialEdges } = useMemo(() => {
    const itemMap = new Map(items.map((item) => [item.id, item]));

    // Create nodes
    const nodes: Node[] = items.map((item) => ({
      id: item.id,
      type: "workItem",
      position: { x: 0, y: 0 },
      data: {
        id: item.id,
        identifier: item.identifier,
        title: item.title,
        status: item.status,
        kind: item.kind,
        priority: item.priority,
        childCount: item.childCount,
        dispatchStatus: item.dispatchStatus,
        dispatchAgent: item.dispatchAgent,
        pipelineState: item.pipelineState,
      } satisfies WorkItemNodeData,
    }));

    // Create edges: parent→child (hierarchy)
    const edges: Edge[] = [];
    for (const item of items) {
      if (item.parentId && itemMap.has(item.parentId)) {
        edges.push({
          id: `parent-${item.parentId}-${item.id}`,
          source: item.parentId,
          target: item.id,
          type: "smoothstep",
          style: EDGE_STYLE_PARENT,
          markerEnd: {
            type: MarkerType.ArrowClosed,
            color: "rgba(255,255,255,0.15)",
            width: 12,
            height: 12,
          },
        });
      }
    }

    // Create edges: dependency (blocked by)
    for (const dep of dependencies) {
      if (itemMap.has(dep.from) && itemMap.has(dep.to)) {
        edges.push({
          id: `dep-${dep.from}-${dep.to}`,
          source: dep.from,
          target: dep.to,
          type: "smoothstep",
          style: EDGE_STYLE_DEPENDENCY,
          animated: true,
          markerEnd: {
            type: MarkerType.ArrowClosed,
            color: "rgba(59,130,246,0.4)",
            width: 12,
            height: 12,
          },
          label: "blocks",
          labelStyle: { fill: "rgba(59,130,246,0.5)", fontSize: 10 },
          labelBgStyle: { fill: "rgba(15,23,41,0.8)" },
        });
      }
    }

    // Auto-layout
    const layoutedNodes = layoutGraph(nodes, edges, direction);

    return { initialNodes: layoutedNodes, initialEdges: edges };
  }, [items, dependencies, direction]);

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

  return (
    <div className={className} style={{ height: "100%", minHeight: 500 }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        nodeTypes={nodeTypes}
        colorMode={"dark" as ColorMode}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        minZoom={0.3}
        maxZoom={2}
        proOptions={{ hideAttribution: true }}
        defaultEdgeOptions={{ type: "smoothstep" }}
      >
        <Background color="rgba(255,255,255,0.03)" gap={20} />
        <Controls
          className="!bg-[#0f1729] !border-white/10 !shadow-lg [&>button]:!bg-[#0f1729] [&>button]:!border-white/10 [&>button]:!text-white/50 [&>button:hover]:!bg-white/5"
        />
        <MiniMap
          className="!bg-[#0a0e17] !border-white/10"
          nodeColor="rgba(255,255,255,0.1)"
          maskColor="rgba(0,0,0,0.6)"
        />
      </ReactFlow>
    </div>
  );
}
