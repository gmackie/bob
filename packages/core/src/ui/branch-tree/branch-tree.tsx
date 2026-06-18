import type { BranchTree as BranchTreeModel } from "@gmacko/core/models";
import { BranchNode } from "./branch-node";

interface BranchTreeProps {
  tree: BranchTreeModel;
  activeBranchId: string;
  onSelect: (branchId: string) => void;
  onCreateBranch?: () => void;
}

export function BranchTree({ tree, activeBranchId, onSelect, onCreateBranch }: BranchTreeProps) {
  return (
    <nav className="flex flex-col gap-0.5 p-2" aria-label="Branch tree">
      <BranchNode node={tree} activeBranchId={activeBranchId} onSelect={onSelect} />
      {onCreateBranch && (
        <button
          data-testid="create-branch-button"
          onClick={onCreateBranch}
          className="mt-1 flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-secondary-foreground"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M12 5v14" />
            <path d="M5 12h14" />
          </svg>
          <span>New branch</span>
        </button>
      )}
    </nav>
  );
}
