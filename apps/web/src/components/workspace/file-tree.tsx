"use client";

import { useCallback, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { useFileChangeEvents } from "~/hooks/use-file-change-events";
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

type GitStatusCode = "M" | "A" | "D" | "??" | "R" | "C";

interface FileTreeNodeProps {
  entry: FileEntry;
  depth: number;
  expandedPaths: Set<string>;
  selectedPath: string | null;
  gitStatusMap: Map<string, GitStatusCode>;
  rootPath: string;
  onToggle: (path: string) => void;
  onSelect: (path: string) => void;
}

/** Given a directory path, find the most important git status among all children */
function getFolderGitStatus(
  dirPath: string,
  rootPath: string,
  gitStatusMap: Map<string, GitStatusCode>,
): GitStatusCode | undefined {
  // Priority order: D > M > A > ??
  const priority: Record<string, number> = { D: 4, M: 3, A: 2, R: 1, "??": 0, C: 0 };
  let best: GitStatusCode | undefined;
  let bestPriority = -1;

  // dirPath is absolute, rootPath is absolute — git status files are relative to rootPath
  const relDir = dirPath.startsWith(rootPath)
    ? dirPath.slice(rootPath.length).replace(/^\//, "")
    : "";

  for (const [file, status] of gitStatusMap) {
    const match = relDir === "" ? true : file.startsWith(relDir + "/");
    if (match) {
      const p = priority[status] ?? 0;
      if (p > bestPriority) {
        bestPriority = p;
        best = status;
      }
    }
  }

  return best;
}

function FileTreeNode({
  entry,
  depth,
  expandedPaths,
  selectedPath,
  gitStatusMap,
  rootPath,
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

  // Compute git status for this entry
  const entryRelPath = entry.path.startsWith(rootPath)
    ? entry.path.slice(rootPath.length).replace(/^\//, "")
    : "";
  const fileGitStatus = entry.isDirectory
    ? getFolderGitStatus(entry.path, rootPath, gitStatusMap)
    : gitStatusMap.get(entryRelPath);

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
        gitStatus={fileGitStatus}
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
              gitStatusMap={gitStatusMap}
              rootPath={rootPath}
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
  /** When provided, polls for file_change events and auto-refreshes affected directories */
  sessionId?: string | null;
}

export function FileTree({ rootPath, onFileSelect, className, sessionId }: FileTreeProps) {
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

  // Fetch git status for the workspace root
  const { data: gitStatusData } = useQuery(
    trpc.filesystem.gitStatus.queryOptions(
      { path: rootPath },
      { refetchInterval: 10_000 },
    ),
  );

  // Build a Map<relativePath, statusCode> for quick lookup
  const gitStatusMap = useMemo(() => {
    const map = new Map<string, GitStatusCode>();
    if (gitStatusData) {
      for (const entry of gitStatusData) {
        map.set(entry.file, entry.status);
      }
    }
    return map;
  }, [gitStatusData]);

  // Poll for file_change events when a sessionId is active; auto-invalidates
  // the filesystem.list query for the parent directory of each changed file.
  useFileChangeEvents({
    sessionId: sessionId ?? null,
    enabled: Boolean(sessionId),
    interval: 3_000,
  });

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
              gitStatusMap={gitStatusMap}
              rootPath={rootPath}
              onToggle={handleToggle}
              onSelect={handleSelect}
            />
          ))}
        </div>
      )}
    </div>
  );
}
