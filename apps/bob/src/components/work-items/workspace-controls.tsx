"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { cn } from "@gmacko/core/ui";
import { toast } from "@gmacko/core/ui/toast";
import { Badge } from "@gmacko/core/ui/badge";
import { Button } from "@gmacko/core/ui/button";

import { OpenChatPanelButton } from "~/components/chat/open-chat-panel-button";
import { getWorkItemEntryPlanSessionHref } from "~/components/work-items/work-item-entry-model";
import { BUILD_COLOR, formatLabel } from "~/lib/design/colors";
import { useTRPC } from "~/trpc/react";

interface WorkspaceControlsProps {
  workItemId: string;
  workItemIdentifier: string;
  workspaceId?: string | null;
  activeSessionId: string | null;
  canExecute: boolean;
  liveHref: string | null;
}

export function WorkspaceControls({
  workItemId,
  workItemIdentifier,
  workspaceId,
  activeSessionId,
  canExecute,
  liveHref,
}: WorkspaceControlsProps) {
  const router = useRouter();
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  // Poll task runs for status updates
  const { data: taskRuns } = useQuery(
    trpc.taskRun.listByWorkItem.queryOptions(
      { workItemId },
      { refetchInterval: 10_000 },
    ),
  );

  const stopSession = useMutation(
    trpc.session.stop.mutationOptions({
      onSuccess: () => {
        toast("Session stopped");
        router.refresh();
      },
      onError: (err) => {
        toast(err.message, {
          style: { background: "#1a0000", borderColor: "#f43f5e40" },
        });
      },
    }),
  );

  const latestRun = (taskRuns as any[])?.[0];
  const runStatus = latestRun?.status as string | undefined;

  const runner = useRunnerStatus(workspaceId);

  return (
    <div className="space-y-4">
      {/* Run status */}
      {latestRun && (
        <div className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">Latest run:</span>
          <Badge variant={BUILD_COLOR[runStatus ?? ""] ?? "default"}>
            {formatLabel(runStatus ?? "unknown")}
          </Badge>
          {latestRun.branch && (
            <span className="font-mono text-xs text-muted-foreground">
              {latestRun.branch}
            </span>
          )}
        </div>
      )}

      {/* Action buttons */}
      <div className="flex flex-wrap gap-3">
        {activeSessionId ? (
          <>
            {liveHref ? (
              <Link
                href={liveHref}
                className="rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition hover:bg-primary/90"
              >
                Resume live workspace
              </Link>
            ) : (
              <Link
                href={`/chat?session=${activeSessionId}`}
                className="rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition hover:bg-primary/90"
              >
                Open session console
              </Link>
            )}

            <OpenChatPanelButton
              sessionId={activeSessionId}
              workItemId={workItemId}
              label={workItemIdentifier}
            />

            <Button
              variant="outline"
              size="sm"
              onClick={() => stopSession.mutate({ id: activeSessionId })}
              disabled={stopSession.isPending}
            >
              {stopSession.isPending ? "Stopping..." : "Stop"}
            </Button>
          </>
        ) : canExecute ? (
          <>
            <StartAgentButton workItemId={workItemId} workspaceId={workspaceId} />
            <OpenChatPanelButton
              workItemId={workItemId}
              label={workItemIdentifier}
            />
          </>
        ) : (
          <span className="text-sm text-muted-foreground">
            Only task work items can open the execution workspace.
          </span>
        )}
      </div>

      {/* Runner health at the point of dispatch */}
      <RunnerStatusChip runner={runner} showOfflineHint={!activeSessionId && canExecute} />
    </div>
  );
}

type RunnerStatus =
  | { state: "online"; name: string }
  | { state: "offline"; name: string; lastSeen: string }
  | { state: "none" }
  | { state: "loading" };

/**
 * Resolve the runner (daemon workspace) this work item would dispatch to:
 * the matching workspace when the work item's repo is mapped to one, else
 * the most recently seen workspace (single-runner setups).
 */
function useRunnerStatus(workspaceId?: string | null): RunnerStatus {
  const trpc = useTRPC();
  const { data: memberships } = useQuery(
    trpc.workspace.list.queryOptions(undefined, {
      staleTime: 15_000,
      refetchInterval: 30_000,
    }),
  );

  if (!memberships) return { state: "loading" };

  const workspaces = (memberships as any[])
    .map((m) => m.workspace)
    .filter(Boolean);
  if (workspaces.length === 0) return { state: "none" };

  const target =
    (workspaceId && workspaces.find((w) => w.id === workspaceId)) ??
    [...workspaces].sort(
      (a, b) =>
        new Date(b.lastHeartbeat ?? 0).getTime() -
        new Date(a.lastHeartbeat ?? 0).getTime(),
    )[0];

  const last = target.lastHeartbeat ? new Date(target.lastHeartbeat).getTime() : 0;
  const online = Date.now() - last < 5 * 60 * 1000;
  const name = target.name ?? target.hostname ?? "runner";
  if (online) return { state: "online", name };
  return {
    state: "offline",
    name,
    lastSeen: last ? formatRelativeTime(last) : "never",
  };
}

function formatRelativeTime(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

function RunnerStatusChip({
  runner,
  showOfflineHint,
}: {
  runner: RunnerStatus;
  showOfflineHint: boolean;
}) {
  if (runner.state === "loading") return null;

  if (runner.state === "none") {
    return (
      <p className="flex items-center gap-2 text-xs text-muted-foreground">
        <span className="inline-block h-2 w-2 rounded-full bg-muted-foreground/40" />
        No runner registered — agents can't execute until a node connects.
      </p>
    );
  }

  if (runner.state === "online") {
    return (
      <p className="flex items-center gap-2 text-xs text-muted-foreground">
        <span className="inline-block h-2 w-2 rounded-full bg-emerald-500" />
        Runner {runner.name} online
      </p>
    );
  }

  return (
    <div className="space-y-1">
      <p className="flex items-center gap-2 text-xs text-amber-500">
        <span className="inline-block h-2 w-2 rounded-full bg-amber-500" />
        Runner {runner.name} offline (last seen {runner.lastSeen})
      </p>
      {showOfflineHint && (
        <p className="text-xs text-muted-foreground">
          You can still start the agent — it will run when the runner reconnects.
        </p>
      )}
    </div>
  );
}

const AGENT_OPTIONS: Array<{ id: string; label: string }> = [
  { id: "claude", label: "Claude" },
  { id: "codex", label: "Codex" },
  { id: "grok", label: "Grok" },
  { id: "cursor", label: "Cursor" },
];

function StartAgentButton({
  workItemId,
  workspaceId,
}: {
  workItemId: string;
  workspaceId?: string | null;
}) {
  const router = useRouter();
  const trpc = useTRPC();
  const [agentType, setAgentType] = useState<string>("claude");

  const executeTask = useMutation(
    trpc.taskRun.execute.mutationOptions({
      onSuccess: (result: any) => {
        if (result.status === "blocked") {
          toast(result.blockedReason ?? "Agent blocked");
        } else if (result.sessionId) {
          toast(`${agentLabel(agentType)} started on branch ${result.branch ?? "unknown"}`);
          router.push(getWorkItemEntryPlanSessionHref(workItemId, result.sessionId, workspaceId));
          return;
        } else {
          toast(`${agentLabel(agentType)} started on branch ${result.branch ?? "unknown"}`);
        }
        router.refresh();
      },
      onError: (err) => {
        toast(err.message, {
          style: { background: "#1a0000", borderColor: "#f43f5e40" },
        });
      },
    }),
  );

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="mr-1 text-xs text-muted-foreground">Agent:</span>
        {AGENT_OPTIONS.map((opt) => {
          const selected = opt.id === agentType;
          return (
            <button
              key={opt.id}
              type="button"
              onClick={() => setAgentType(opt.id)}
              disabled={executeTask.isPending}
              className={cn(
                "rounded-full border px-3 py-1 text-xs font-medium transition disabled:opacity-50",
                selected
                  ? "border-primary bg-primary/15 text-foreground"
                  : "border-border text-muted-foreground hover:border-muted-foreground/40 hover:text-foreground",
              )}
            >
              {opt.label}
            </button>
          );
        })}
      </div>
      <Button
        onClick={() => executeTask.mutate({ workItemId, agentType })}
        disabled={executeTask.isPending}
        className="self-start"
      >
        {executeTask.isPending
          ? `Starting ${agentLabel(agentType)}...`
          : `Start ${agentLabel(agentType)}`}
      </Button>
    </div>
  );
}

function agentLabel(id: string): string {
  return AGENT_OPTIONS.find((o) => o.id === id)?.label ?? "agent";
}
