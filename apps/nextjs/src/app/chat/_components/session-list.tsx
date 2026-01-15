"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTRPC } from "~/trpc/react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { cn } from "@bob/ui";
import { Button } from "@bob/ui/button";

type SessionStatus = "provisioning" | "starting" | "running" | "idle" | "stopping" | "stopped" | "error";

interface Session {
  id: string;
  title: string | null;
  status: string;
  agentType: string;
  workingDirectory: string | null;
  lastActivityAt: Date | null;
  createdAt: Date;
}

function StatusIndicator({ status }: { status: string }) {
  const colors: Record<string, string> = {
    running: "bg-green-500",
    idle: "bg-yellow-500",
    starting: "bg-blue-500 animate-pulse",
    provisioning: "bg-blue-500 animate-pulse",
    stopping: "bg-orange-500",
    stopped: "bg-gray-400",
    error: "bg-red-500",
  };

  return (
    <span
      className={cn("inline-block h-2 w-2 rounded-full", colors[status] ?? "bg-gray-400")}
      title={status}
    />
  );
}

function formatRelativeTime(date: Date | null): string {
  if (!date) return "";
  const now = new Date();
  const diff = now.getTime() - new Date(date).getTime();
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}d ago`;
  if (hours > 0) return `${hours}h ago`;
  if (minutes > 0) return `${minutes}m ago`;
  return "now";
}

export function SessionList({
  selectedId,
  onSelect,
}: {
  selectedId?: string;
  onSelect: (id: string) => void;
}) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<SessionStatus | "all">("all");

  const { data, isLoading, error } = useQuery(
    trpc.session.list.queryOptions({
      status: filter === "all" ? undefined : filter,
      limit: 50,
    })
  );

  const createMutation = useMutation(
    trpc.session.create.mutationOptions({
      onSuccess: (newSession) => {
        queryClient.invalidateQueries({ queryKey: trpc.session.list.queryKey() });
        onSelect(newSession!.id);
      },
    })
  );

  const handleNewSession = () => {
    createMutation.mutate({
      workingDirectory: process.cwd(),
      agentType: "opencode",
    });
  };

  const sessions = data?.items ?? [];

  return (
    <div className="flex h-full flex-col border-r">
      <div className="flex items-center justify-between border-b p-3">
        <h2 className="text-sm font-semibold">Sessions</h2>
        <Button
          size="sm"
          onClick={handleNewSession}
          disabled={createMutation.isPending}
        >
          {createMutation.isPending ? "..." : "+ New"}
        </Button>
      </div>

      <div className="border-b p-2">
        <select
          value={filter}
          onChange={(e) => setFilter(e.target.value as SessionStatus | "all")}
          className="bg-background w-full rounded border px-2 py-1 text-xs"
        >
          <option value="all">All Sessions</option>
          <option value="running">Running</option>
          <option value="idle">Idle</option>
          <option value="stopped">Stopped</option>
          <option value="error">Error</option>
        </select>
      </div>

      <div className="flex-1 overflow-y-auto">
        {isLoading && (
          <div className="p-4 text-center text-sm text-gray-500">Loading...</div>
        )}

        {error && (
          <div className="p-4 text-center text-sm text-red-500">
            Failed to load sessions
          </div>
        )}

        {!isLoading && sessions.length === 0 && (
          <div className="p-4 text-center text-sm text-gray-500">
            No sessions found
          </div>
        )}

        {sessions.map((session) => (
          <button
            key={session.id}
            onClick={() => onSelect(session.id)}
            className={cn(
              "w-full border-b p-3 text-left transition-colors hover:bg-gray-50 dark:hover:bg-gray-800",
              selectedId === session.id && "bg-gray-100 dark:bg-gray-800"
            )}
          >
            <div className="flex items-center gap-2">
              <StatusIndicator status={session.status} />
              <span className="flex-1 truncate text-sm font-medium">
                {session.title ?? `Session ${session.id.slice(0, 8)}`}
              </span>
            </div>
            <div className="mt-1 flex items-center gap-2 text-xs text-gray-500">
              <span>{session.agentType}</span>
              <span>·</span>
              <span>{formatRelativeTime(session.lastActivityAt ?? session.createdAt)}</span>
            </div>
            {session.workingDirectory && (
              <div className="mt-1 truncate text-xs text-gray-400">
                {session.workingDirectory}
              </div>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}
