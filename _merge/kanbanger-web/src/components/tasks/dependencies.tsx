"use client";

import { useState } from "react";
import { cn } from "@linear-clone/ui/lib/utils";
import { Input } from "@linear-clone/ui/components/input";
import { StatusBadge, type TaskStatus } from "./status-badge";
import {
  ChevronDown,
  ChevronRight,
  X,
  Loader2,
  ArrowUpRight,
  ArrowDownRight,
  Link2,
} from "lucide-react";

interface DependencyIssue {
  id: string;
  identifier: string;
  title: string;
  status: string;
  priority: string;
}

interface DependenciesProps {
  blockedBy: Array<{ id: string; issue: DependencyIssue }>;
  blocking: Array<{ id: string; issue: DependencyIssue }>;
  isLoading?: boolean;
  onAddBlockedBy?: (issueId: string) => Promise<void>;
  onAddBlocking?: (issueId: string) => Promise<void>;
  onRemove?: (dependencyId: string) => Promise<void>;
  onIssueClick?: (issueId: string) => void;
  searchResults?: DependencyIssue[];
  onSearch?: (query: string) => void;
  isSearching?: boolean;
}

function DependencyItem({
  dependency,
  type,
  onRemove,
  onClick,
}: {
  dependency: { id: string; issue: DependencyIssue };
  type: "blocked_by" | "blocking";
  onRemove?: () => void;
  onClick?: () => void;
}) {
  const [isRemoving, setIsRemoving] = useState(false);

  const handleRemove = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!onRemove) return;
    setIsRemoving(true);
    try {
      await onRemove();
    } finally {
      setIsRemoving(false);
    }
  };

  const isComplete = dependency.issue.status === "done" || dependency.issue.status === "canceled";

  return (
    <div
      className={cn(
        "group flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-muted cursor-pointer",
        isComplete && "opacity-60"
      )}
      onClick={onClick}
    >
      {type === "blocked_by" ? (
        <ArrowDownRight className="h-3.5 w-3.5 text-orange-500 flex-shrink-0" />
      ) : (
        <ArrowUpRight className="h-3.5 w-3.5 text-blue-500 flex-shrink-0" />
      )}

      <StatusBadge status={dependency.issue.status as TaskStatus} />

      <span className="font-mono text-xs text-muted-foreground flex-shrink-0">
        {dependency.issue.identifier}
      </span>

      <span
        className={cn(
          "flex-1 truncate text-sm",
          isComplete && "line-through"
        )}
      >
        {dependency.issue.title}
      </span>

      <button
        onClick={handleRemove}
        disabled={isRemoving}
        className="opacity-0 group-hover:opacity-100 p-0.5 hover:bg-muted-foreground/20 rounded transition-opacity"
      >
        {isRemoving ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <X className="h-3.5 w-3.5 text-muted-foreground" />
        )}
      </button>
    </div>
  );
}

export function Dependencies({
  blockedBy,
  blocking,
  isLoading,
  onAddBlockedBy,
  onAddBlocking,
  onRemove,
  onIssueClick,
  searchResults = [],
  onSearch,
  isSearching,
}: DependenciesProps) {
  const [isExpanded, setIsExpanded] = useState(true);
  const [isAdding, setIsAdding] = useState<"blocked_by" | "blocking" | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  const totalCount = blockedBy.length + blocking.length;
  const blockedByUnresolved = blockedBy.filter(
    (d) => d.issue.status !== "done" && d.issue.status !== "canceled"
  ).length;

  const handleSearchChange = (value: string) => {
    setSearchQuery(value);
    onSearch?.(value);
  };

  const handleSelect = async (issue: DependencyIssue) => {
    if (isAdding === "blocked_by") {
      await onAddBlockedBy?.(issue.id);
    } else if (isAdding === "blocking") {
      await onAddBlocking?.(issue.id);
    }
    setIsAdding(null);
    setSearchQuery("");
  };

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading dependencies...
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className="flex items-center gap-2 text-sm font-medium hover:text-foreground"
        >
          {isExpanded ? (
            <ChevronDown className="h-4 w-4" />
          ) : (
            <ChevronRight className="h-4 w-4" />
          )}
          <Link2 className="h-4 w-4" />
          Dependencies
          {totalCount > 0 && (
            <span className="text-muted-foreground font-normal">
              ({totalCount})
            </span>
          )}
        </button>

        {blockedByUnresolved > 0 && (
          <span className="text-xs px-1.5 py-0.5 rounded bg-orange-500/10 text-orange-500">
            {blockedByUnresolved} blocking
          </span>
        )}
      </div>

      {isExpanded && (
        <div className="space-y-3 pl-2">
          {blockedBy.length > 0 && (
            <div className="space-y-1">
              <span className="text-xs text-muted-foreground uppercase tracking-wider">
                Blocked by
              </span>
              {blockedBy.map((dep) => (
                <DependencyItem
                  key={dep.id}
                  dependency={dep}
                  type="blocked_by"
                  onRemove={() => onRemove?.(dep.id)}
                  onClick={() => onIssueClick?.(dep.issue.id)}
                />
              ))}
            </div>
          )}

          {blocking.length > 0 && (
            <div className="space-y-1">
              <span className="text-xs text-muted-foreground uppercase tracking-wider">
                Blocking
              </span>
              {blocking.map((dep) => (
                <DependencyItem
                  key={dep.id}
                  dependency={dep}
                  type="blocking"
                  onRemove={() => onRemove?.(dep.id)}
                  onClick={() => onIssueClick?.(dep.issue.id)}
                />
              ))}
            </div>
          )}

          {isAdding ? (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">
                  {isAdding === "blocked_by" ? "Add blocker:" : "Add blocked issue:"}
                </span>
                <button
                  onClick={() => {
                    setIsAdding(null);
                    setSearchQuery("");
                  }}
                  className="text-xs text-muted-foreground hover:text-foreground"
                >
                  Cancel
                </button>
              </div>
              <div className="relative">
                <Input
                  autoFocus
                  value={searchQuery}
                  onChange={(e) => handleSearchChange(e.target.value)}
                  placeholder="Search issues..."
                  className="h-8 text-sm"
                />
                {isSearching && (
                  <Loader2 className="absolute right-2 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-muted-foreground" />
                )}
              </div>
              {searchResults.length > 0 && (
                <div className="max-h-48 overflow-y-auto rounded-md border border-border bg-popover">
                  {searchResults.map((issue) => (
                    <button
                      key={issue.id}
                      onClick={() => handleSelect(issue)}
                      className="flex items-center gap-2 w-full px-2 py-1.5 text-sm hover:bg-muted text-left"
                    >
                      <StatusBadge status={issue.status as TaskStatus} />
                      <span className="font-mono text-xs text-muted-foreground">
                        {issue.identifier}
                      </span>
                      <span className="truncate">{issue.title}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="flex gap-2">
              <button
                onClick={() => setIsAdding("blocked_by")}
                className="flex items-center gap-1.5 px-2 py-1 text-xs text-muted-foreground hover:text-foreground hover:bg-muted rounded-md"
              >
                <ArrowDownRight className="h-3.5 w-3.5" />
                Add blocker
              </button>
              <button
                onClick={() => setIsAdding("blocking")}
                className="flex items-center gap-1.5 px-2 py-1 text-xs text-muted-foreground hover:text-foreground hover:bg-muted rounded-md"
              >
                <ArrowUpRight className="h-3.5 w-3.5" />
                Add blocked
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
