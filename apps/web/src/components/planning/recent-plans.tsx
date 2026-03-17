"use client";

import { useQuery } from "@tanstack/react-query";

import { Badge } from "@bob/ui/badge";

import { useChatPanel } from "~/components/chat/chat-panel-provider";
import { useTRPC } from "~/trpc/react";

function formatRelativeDate(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60_000);
  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHrs = Math.floor(diffMins / 60);
  if (diffHrs < 24) return `${diffHrs}h ago`;
  const diffDays = Math.floor(diffHrs / 24);
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}

const STATUS_VARIANT: Record<string, "default" | "slate" | "blue" | "amber" | "emerald" | "rose"> = {
  provisioning: "amber",
  running: "blue",
  stopped: "slate",
  completed: "emerald",
  failed: "rose",
};

export function RecentPlans() {
  const trpc = useTRPC();
  const { openPanel } = useChatPanel();

  const { data: sessions, isLoading } = useQuery(
    trpc.planSession.list.queryOptions({ limit: 5 }),
  );

  if (isLoading) {
    return (
      <div className="animate-pulse space-y-2">
        {Array.from({ length: 3 }).map((_, i) => (
          <div
            key={i}
            className="h-10 rounded-lg bg-card"
          />
        ))}
      </div>
    );
  }

  if (!sessions || sessions.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-border px-6 py-6 text-center">
        <div className="text-sm text-muted-foreground">No planning sessions yet.</div>
        <div className="mt-1 text-xs text-muted-foreground">
          Start a planning session to break goals into actionable tasks.
        </div>
      </div>
    );
  }

  return (
    <ul className="space-y-1">
      {sessions.map((session) => (
        <li key={session.id}>
          <button
            type="button"
            className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition hover:bg-accent"
            onClick={() =>
              openPanel({
                sessionId: session.id,
                label: session.title ?? "Planning session",
              })
            }
          >
            <span className="min-w-0 flex-1 truncate text-sm text-foreground">
              {session.title ?? "Untitled session"}
            </span>
            <Badge
              variant={STATUS_VARIANT[session.status] ?? "slate"}
              className="shrink-0 text-[10px]"
            >
              {session.status}
            </Badge>
            <span className="shrink-0 text-xs text-muted-foreground">
              {formatRelativeDate(new Date(session.createdAt))}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}
