import type { BranchTree as BranchTreeModel } from "@gmacko/models";
import { BranchNode } from "./branch-node";

interface BranchTreeProps {
  tree: BranchTreeModel;
  activeBranchId: string;
  onSelect: (branchId: string) => void;
}

export function BranchTree({ tree, activeBranchId, onSelect }: BranchTreeProps) {
  return (
    <nav className="flex flex-col gap-0.5 p-2" aria-label="Branch tree">
      <BranchNode node={tree} activeBranchId={activeBranchId} onSelect={onSelect} />
    </nav>
  );
}
