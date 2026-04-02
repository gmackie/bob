"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "@bob/ui/toast";
import { Badge } from "@bob/ui/badge";
import { Button } from "@bob/ui/button";

import { OpenChatPanelButton } from "~/components/chat/open-chat-panel-button";
import { BUILD_COLOR, formatLabel } from "~/lib/design/colors";
import { useTRPC } from "~/trpc/react";

interface WorkspaceControlsProps {
  workItemId: string;
  workItemIdentifier: string;
  activeSessionId: string | null;
  canExecute: boolean;
  liveHref: string | null;
}

export function WorkspaceControls({
  workItemId,
  workItemIdentifier,
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
            <StartAgentButton workItemId={workItemId} />
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
    </div>
  );
}

function StartAgentButton({ workItemId }: { workItemId: string }) {
  const router = useRouter();
  const trpc = useTRPC();

  const executeTask = useMutation(
    trpc.taskRun.execute.mutationOptions({
      onSuccess: (result: any) => {
        if (result.status === "blocked") {
          toast(result.blockedReason ?? "Agent blocked");
        } else if (result.sessionId) {
          toast(`Agent started on branch ${result.branch ?? "unknown"}`);
          router.push(`/work-items/${workItemId}/plan/${result.sessionId}`);
          return;
        } else {
          toast(`Agent started on branch ${result.branch ?? "unknown"}`);
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
    <Button
      onClick={() => executeTask.mutate({ workItemId })}
      disabled={executeTask.isPending}
    >
      {executeTask.isPending ? "Starting agent..." : "Start agent"}
    </Button>
  );
}
