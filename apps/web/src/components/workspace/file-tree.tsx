"use client";

import { useCallback, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { useTRPC } from "~/trpc/react";

import { FileTreeItem } from "./file-tree-item";

/** Directories to hide from the file tree */
const FILTERED_NAMES = new Set([
  "node_modules",
  ".git",
  ".next",
  "dist",
  ".cache",
  ".turbo",
  "__pycache__",
  ".DS_Store",
]);

interface FileEntry {
  name: string;
  path: string;
  isDirectory: boolean;
  isFile: boolean;
  size: number;
  modified: string;
}

/** Sort entries: directories first, then files, both alphabetical */
function sortEntries(entries: FileEntry[]): FileEntry[] {
  return [...entries].sort((a, b) => {
    if (a.isDirectory && !b.isDirectory) return -1;
    if (!a.isDirectory && b.isDirectory) return 1;
    return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
  });
}

function filterEntries(entries: FileEntry[]): FileEntry[] {
  return entries.filter((e) => !FILTERED_NAMES.has(e.name));
}

interface FileTreeNodeProps {
  entry: FileEntry;
  depth: number;
  expandedPaths: Set<string>;
  selectedPath: string | null;
  onToggle: (path: string) => void;
  onSelect: (path: string) => void;
}

function FileTreeNode({
  entry,
  depth,
  expandedPaths,
  selectedPath,
  onToggle,
  onSelect,
}: FileTreeNodeProps) {
  const trpc = useTRPC();
  const isExpanded = expandedPaths.has(entry.path);

  const { data: children, isLoading } = useQuery(
    trpc.filesystem.list.queryOptions(
      { path: entry.path, showHidden: false },
      { enabled: entry.isDirectory && isExpanded },
    ),
  );

  const sorted = children ? sortEntries(filterEntries(children)) : [];

  return (
    <>
      <FileTreeItem
        name={entry.name}
        path={entry.path}
        isDirectory={entry.isDirectory}
        depth={depth}
        isExpanded={isExpanded}
        isSelected={selectedPath === entry.path}
        isLoading={entry.isDirectory && isExpanded && isLoading}
        onToggle={onToggle}
        onSelect={onSelect}
      />
      {entry.isDirectory && isExpanded && !isLoading && (
        <>
          {sorted.length === 0 && children && (
            <div
              className="px-2 py-1 text-xs text-muted-foreground italic"
              style={{ paddingLeft: `${(depth + 1) * 16 + 8}px` }}
            >
              Empty folder
            </div>
          )}
          {sorted.map((child) => (
            <FileTreeNode
              key={child.path}
              entry={child}
              depth={depth + 1}
              expandedPaths={expandedPaths}
              selectedPath={selectedPath}
              onToggle={onToggle}
              onSelect={onSelect}
            />
          ))}
        </>
      )}
      {/* Skeleton loading state for expanding folders */}
      {entry.isDirectory && isExpanded && isLoading && (
        <div style={{ paddingLeft: `${(depth + 1) * 16 + 8}px` }}>
          {Array.from({ length: 3 }).map((_, i) => (
            <div
              key={i}
              className="flex items-center gap-1.5 px-2 py-1"
            >
              <span className="h-4 w-4 shrink-0" />
              <span className="h-2 w-2 shrink-0 rounded-full bg-muted-foreground/20 animate-pulse" />
              <span
                className="h-3 rounded bg-muted-foreground/10 animate-pulse"
                style={{ width: `${60 + i * 20}px` }}
              />
            </div>
          ))}
        </div>
      )}
    </>
  );
}

export interface FileTreeProps {
  /** The root directory path to display */
  rootPath: string;
  /** Called when a file is selected */
  onFileSelect?: (path: string) => void;
  /** Additional CSS class name */
  className?: string;
}

export function FileTree({ rootPath, onFileSelect, className }: FileTreeProps) {
  const trpc = useTRPC();
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(
    () => new Set([rootPath]),
  );
  const [selectedPath, setSelectedPath] = useState<string | null>(null);

  const { data: rootEntries, isLoading: rootLoading } = useQuery(
    trpc.filesystem.list.queryOptions(
      { path: rootPath, showHidden: false },
    ),
  );

  const handleToggle = useCallback((path: string) => {
    setExpandedPaths((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  }, []);

  const handleSelect = useCallback(
    (path: string) => {
      setSelectedPath(path);
      onFileSelect?.(path);
    },
    [onFileSelect],
  );

  const sorted = rootEntries ? sortEntries(filterEntries(rootEntries)) : [];

  return (
    <div className={className} role="tree" aria-label="File tree">
      {rootLoading && (
        <div className="space-y-0.5 p-1">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex items-center gap-1.5 px-2 py-1">
              <span className="h-4 w-4 shrink-0 rounded bg-muted-foreground/10 animate-pulse" />
              <span className="h-2 w-2 shrink-0 rounded-full bg-muted-foreground/20 animate-pulse" />
              <span
                className="h-3 rounded bg-muted-foreground/10 animate-pulse"
                style={{ width: `${80 + i * 15}px` }}
              />
            </div>
          ))}
        </div>
      )}
      {!rootLoading && sorted.length === 0 && rootEntries && (
        <div className="px-3 py-4 text-sm text-muted-foreground text-center">
          No files found
        </div>
      )}
      {!rootLoading && (
        <div className="space-y-0.5 p-1">
          {sorted.map((entry) => (
            <FileTreeNode
              key={entry.path}
              entry={entry}
              depth={0}
              expandedPaths={expandedPaths}
              selectedPath={selectedPath}
              onToggle={handleToggle}
              onSelect={handleSelect}
            />
          ))}
        </div>
      )}
    </div>
  );
}
