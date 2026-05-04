"use client";

import Link from "next/link";

import { cn } from "@gmacko/core/ui";
import { Badge } from "@gmacko/core/ui/badge";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface KanbanCardItem {
  id: string;
  identifier?: string;
  title: string;
  kind: string;
  status: string;
  priority?: string;
  externalProvider?: string | null;
  createdAt?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const KIND_VARIANT: Record<string, "default" | "slate" | "blue" | "purple" | "amber" | "emerald" | "rose" | "orange"> = {
  issue: "slate",
  epic: "purple",
  task: "blue",
};

const PRIORITY_BORDER: Record<string, string> = {
  urgent: "border-l-rose-500",
  high: "border-l-orange-500",
  medium: "border-l-amber-500",
  low: "border-l-blue-500",
};

function formatRelativeTime(dateString: string): string {
  const now = Date.now();
  const then = new Date(dateString).getTime();
  const diffMs = now - then;

  if (Number.isNaN(diffMs)) return "";

  const seconds = Math.floor(diffMs / 1000);
  if (seconds < 60) return "just now";

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;

  const months = Math.floor(days / 30);
  return `${months}mo ago`;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function KanbanCard({ item }: { item: KanbanCardItem }) {
  const kindVariant = KIND_VARIANT[item.kind] ?? "default";
  const priorityBorder = item.priority ? PRIORITY_BORDER[item.priority] : undefined;

  return (
    <Link
      href={`/work-items/${item.id}`}
      className={cn(
        "block rounded-lg border border-border bg-card px-3 py-2.5 transition",
        "hover:border-muted-foreground/30 hover:shadow-sm",
        priorityBorder && `border-l-2 ${priorityBorder}`,
      )}
    >
      {/* Top row: identifier + kind badge */}
      <div className="flex items-center justify-between gap-2">
        {item.identifier && (
          <span className="font-mono text-[11px] uppercase tracking-[0.15em] text-muted-foreground">
            {item.identifier}
          </span>
        )}
        <div className="ml-auto flex items-center gap-1.5">
          {item.externalProvider === "linear" && (
            <Badge variant="purple" className="text-[10px] px-1.5 py-0">
              Linear
            </Badge>
          )}
          <Badge variant={kindVariant} className="text-[10px] px-1.5 py-0">
            {item.kind}
          </Badge>
        </div>
      </div>

      {/* Title */}
      <p className="mt-1.5 text-sm font-medium leading-snug text-foreground line-clamp-2">
        {item.title}
      </p>

      {/* Bottom row: priority + relative time */}
      <div className="mt-2 flex items-center gap-2 text-[11px] text-muted-foreground">
        {item.priority && item.priority !== "no_priority" && (
          <span className="capitalize">{item.priority}</span>
        )}
        {item.createdAt && (
          <span className="ml-auto">{formatRelativeTime(item.createdAt)}</span>
        )}
      </div>
    </Link>
  );
}
