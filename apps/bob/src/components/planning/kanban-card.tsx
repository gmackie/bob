"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";

import { cn } from "@gmacko/core/ui";
import { Badge } from "@gmacko/core/ui/badge";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@gmacko/core/ui/context-menu";
import { getProjectWorkItemHref } from "~/components/projects/project-detail-tabs-model";

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
  agentStatus?: {
    sessionId: string;
    status: string;
    agentType: string;
  } | null;
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

export function KanbanCard({
  item,
  onDispatch,
  onStatusChange,
  workspaceId,
}: {
  item: KanbanCardItem;
  onDispatch?: (id: string) => void;
  onStatusChange?: (id: string, status: string) => void;
  workspaceId?: string | null;
}) {
  const router = useRouter();
  const kindVariant = KIND_VARIANT[item.kind] ?? "default";
  const priorityBorder = item.priority ? PRIORITY_BORDER[item.priority] : undefined;
  const isStale = item.status === "in_progress" && !item.agentStatus;
  const hasAgent = !!item.agentStatus;
  const itemHref = getProjectWorkItemHref(item, workspaceId);

  const cardContent = (
    <div
      className={cn(
        "block rounded-lg border bg-card px-3 py-2.5 transition cursor-pointer",
        "hover:border-muted-foreground/30 hover:shadow-sm",
        priorityBorder && `border-l-2 ${priorityBorder}`,
        isStale ? "border-amber-500/50 bg-amber-950/10" : "border-border",
        hasAgent && "border-emerald-500/40",
      )}
      onClick={() => router.push(itemHref)}
    >
      {/* Top row: identifier + badges */}
      <div className="flex items-center justify-between gap-2">
        {item.identifier && (
          <span className="font-mono text-[11px] uppercase tracking-[0.15em] text-muted-foreground">
            {item.identifier}
          </span>
        )}
        <div className="ml-auto flex items-center gap-1.5">
          {hasAgent && (
            <Badge variant="emerald" className="text-[10px] px-1.5 py-0">
              {item.agentStatus!.agentType}
            </Badge>
          )}
          {isStale && (
            <Badge variant="amber" className="text-[10px] px-1.5 py-0">
              stale
            </Badge>
          )}
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

      {/* Bottom row: agent status / dispatch / time */}
      <div className="mt-2 flex items-center gap-2 text-[11px] text-muted-foreground">
        {item.priority && item.priority !== "no_priority" && (
          <span className="capitalize">{item.priority}</span>
        )}
        {onDispatch && !hasAgent && (
          <button
            type="button"
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); onDispatch(item.id); }}
            className="rounded bg-primary/20 px-1.5 py-0.5 text-[10px] font-medium text-primary hover:bg-primary/30 transition"
          >
            Dispatch
          </button>
        )}
        {item.createdAt && (
          <span className="ml-auto">{formatRelativeTime(item.createdAt)}</span>
        )}
      </div>
    </div>
  );

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        {cardContent}
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuLabel>{item.identifier ?? item.id.slice(0, 8)}</ContextMenuLabel>
        <ContextMenuSeparator />
        <ContextMenuItem onClick={() => router.push(itemHref)}>
          View details
        </ContextMenuItem>
        {item.identifier && (
          <ContextMenuItem onClick={() => navigator.clipboard.writeText(item.identifier!)}>
            Copy identifier
          </ContextMenuItem>
        )}
        {onDispatch && !hasAgent && (
          <ContextMenuItem onClick={() => onDispatch(item.id)}>
            Dispatch to agent
          </ContextMenuItem>
        )}
        {hasAgent && (
          <ContextMenuItem onClick={() => router.push(`/runs/${item.agentStatus!.sessionId}`)}>
            View agent run
          </ContextMenuItem>
        )}
        <ContextMenuSeparator />
        <ContextMenuLabel>Set status</ContextMenuLabel>
        {["backlog", "todo", "in_progress", "in_review", "done"].map((s) => (
          <ContextMenuItem
            key={s}
            disabled={item.status === s || !onStatusChange}
            onClick={() => onStatusChange?.(item.id, s)}
          >
            {s.replace(/_/g, " ")}
          </ContextMenuItem>
        ))}
      </ContextMenuContent>
    </ContextMenu>
  );
}
