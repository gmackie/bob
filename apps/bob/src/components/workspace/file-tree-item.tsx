"use client";

import { cn } from "@gmacko/core/ui";

// Extension-to-color mapping for file type indicators
function getFileIndicatorColor(name: string): string {
  const ext = name.slice(name.lastIndexOf(".")).toLowerCase();
  switch (ext) {
    case ".tsx":
    case ".jsx":
      return "bg-blue-500";
    case ".ts":
    case ".js":
      return "bg-amber-500";
    case ".css":
    case ".scss":
      return "bg-purple-500";
    case ".json":
      return "bg-amber-400";
    case ".md":
    case ".mdx":
      return "bg-slate-400";
    default:
      return "bg-muted-foreground/40";
  }
}

type GitStatusCode = "M" | "A" | "D" | "??" | "R" | "C";

function getGitStatusColor(status: GitStatusCode): string {
  switch (status) {
    case "M":
      return "bg-amber-500";
    case "A":
      return "bg-emerald-500";
    case "D":
      return "bg-rose-500";
    case "??":
      return "bg-slate-400";
    case "R":
      return "bg-blue-500";
    case "C":
      return "bg-blue-400";
    default:
      return "bg-muted-foreground/40";
  }
}

export interface FileTreeItemProps {
  name: string;
  path: string;
  isDirectory: boolean;
  depth: number;
  isExpanded?: boolean;
  isSelected?: boolean;
  isLoading?: boolean;
  gitStatus?: GitStatusCode;
  onToggle?: (path: string) => void;
  onSelect?: (path: string) => void;
}

export function FileTreeItem({
  name,
  path,
  isDirectory,
  depth,
  isExpanded = false,
  isSelected = false,
  isLoading = false,
  gitStatus,
  onToggle,
  onSelect,
}: FileTreeItemProps) {
  const handleClick = () => {
    if (isDirectory) {
      onToggle?.(path);
    } else {
      onSelect?.(path);
    }
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      className={cn(
        "flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-left text-sm",
        "hover:bg-accent transition-colors duration-[50ms]",
        "cursor-pointer select-none",
        isSelected && "bg-accent",
      )}
      style={{ paddingLeft: `${depth * 16 + 8}px` }}
    >
      {/* Chevron for directories, spacer for files */}
      {isDirectory ? (
        <span
          className={cn(
            "flex h-4 w-4 shrink-0 items-center justify-center text-muted-foreground transition-transform duration-150",
            isExpanded && "rotate-90",
          )}
        >
          <ChevronIcon />
        </span>
      ) : (
        <span className="h-4 w-4 shrink-0" />
      )}

      {/* Icon */}
      {isDirectory ? (
        <FolderIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
      ) : (
        <span
          className={cn(
            "h-2 w-2 shrink-0 rounded-full",
            getFileIndicatorColor(name),
          )}
        />
      )}

      {/* Name */}
      <span className="truncate text-foreground">{name}</span>

      {/* Spacer to push indicators to the right */}
      <span className="flex-1" />

      {/* Git status indicator */}
      {gitStatus && !isLoading && (
        <span
          className={cn(
            "size-1.5 shrink-0 rounded-full",
            getGitStatusColor(gitStatus),
          )}
          title={gitStatus}
        />
      )}

      {/* Loading indicator */}
      {isLoading && (
        <span className="h-3 w-3 shrink-0 animate-spin rounded-full border border-muted-foreground/30 border-t-muted-foreground" />
      )}
    </button>
  );
}

function ChevronIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 12 12"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M4.5 2.5L8 6L4.5 9.5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function FolderIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 16 16"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M2 4C2 3.44772 2.44772 3 3 3H6.17157C6.43679 3 6.69114 3.10536 6.87868 3.29289L7.70711 4.12132C7.89464 4.30886 8.149 4.41421 8.41421 4.41421H13C13.5523 4.41421 14 4.86193 14 5.41421V12C14 12.5523 13.5523 13 13 13H3C2.44772 13 2 12.5523 2 12V4Z"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
    </svg>
  );
}
