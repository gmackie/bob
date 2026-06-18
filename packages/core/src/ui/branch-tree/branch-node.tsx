import type { BranchTree as BranchTreeModel } from "@gmacko/core/models";
import { cn } from "../utils";

interface BranchNodeProps {
  node: BranchTreeModel;
  activeBranchId: string;
  onSelect: (branchId: string) => void;
  depth?: number;
}

export function BranchNode({ node, activeBranchId, onSelect, depth = 0 }: BranchNodeProps) {
  const isActive = node.branch.id === activeBranchId;

  return (
    <div>
      <button
        data-active={isActive}
        onClick={() => onSelect(node.branch.id)}
        className={cn(
          "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors",
          isActive
            ? "bg-accent text-primary"
            : "text-secondary-foreground hover:bg-muted",
        )}
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
      >
        <span className="truncate">{node.branch.name}</span>
        <span className="ml-auto text-xs text-muted-foreground">
          {node.messageCount}
        </span>
      </button>
      {node.children.map((child) => (
        <BranchNode
          key={child.branch.id}
          node={child}
          activeBranchId={activeBranchId}
          onSelect={onSelect}
          depth={depth + 1}
        />
      ))}
    </div>
  );
}
