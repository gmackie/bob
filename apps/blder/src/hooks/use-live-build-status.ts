"use client";

import { useCallback, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { useSessionSocket } from "~/hooks/use-session-socket";
import { useTRPC } from "~/trpc/react";

interface UseLiveBuildStatusOptions {
  /** The work-item / task ID to track builds for */
  taskId: string;
  /** Whether polling is enabled (default true) */
  enabled?: boolean;
}

/**
 * Polls forgegraph revisions, builds, and deployments at a 5-second interval
 * for a given task, providing live build/deploy status updates.
 */
export function useLiveBuildStatus({
  taskId,
  enabled = true,
}: UseLiveBuildStatusOptions) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  const { data: revisions, isLoading: revisionsLoading } = useQuery({
    ...trpc.forgegraph.listRevisions.queryOptions({ taskId, limit: 5 }),
    enabled,
    refetchInterval: 5_000,
  });

  const latestRevisionId = revisions?.[0]?.id ?? null;

  const { data: gatewayInfo } = useQuery(
    trpc.session.getGatewayWebSocketUrl.queryOptions(undefined, {
      enabled,
      staleTime: 60_000,
    }),
  );

  const handleWorkspaceEvent = useCallback(
    (event: { eventType: string }) => {
      if (
        event.eventType !== "build_status" &&
        event.eventType !== "deploy_status"
      ) {
        return;
      }

      void queryClient.invalidateQueries({
        queryKey: trpc.forgegraph.listRevisions.queryKey({ taskId, limit: 5 }),
      });

      if (!latestRevisionId) return;

      void queryClient.invalidateQueries({
        queryKey: trpc.forgegraph.listBuilds.queryKey({
          revisionId: latestRevisionId,
        }),
      });
      void queryClient.invalidateQueries({
        queryKey: trpc.forgegraph.listDeployments.queryKey({
          revisionId: latestRevisionId,
        }),
      });
    },
    [
      latestRevisionId,
      queryClient,
      taskId,
      trpc.forgegraph.listBuilds,
      trpc.forgegraph.listDeployments,
      trpc.forgegraph.listRevisions,
    ],
  );

  const { connectionState, subscribeWorkspace, unsubscribeWorkspace } =
    useSessionSocket({
      gatewayUrl: gatewayInfo?.url ?? "",
      token: gatewayInfo?.token ?? "",
      onWorkspaceEvent: handleWorkspaceEvent,
      enabled: enabled && Boolean(gatewayInfo?.token),
    });

  useEffect(() => {
    if (connectionState.status !== "connected") return;
    subscribeWorkspace();
    return () => unsubscribeWorkspace();
  }, [connectionState.status, subscribeWorkspace, unsubscribeWorkspace]);

  const { data: builds, isLoading: buildsLoading } = useQuery({
    ...trpc.forgegraph.listBuilds.queryOptions({
      revisionId: latestRevisionId!,
    }),
    enabled: enabled && !!latestRevisionId,
    refetchInterval: 5_000,
  });

  const { data: deployments, isLoading: deploymentsLoading } = useQuery({
    ...trpc.forgegraph.listDeployments.queryOptions({
      revisionId: latestRevisionId!,
    }),
    enabled: enabled && !!latestRevisionId,
    refetchInterval: 5_000,
  });

  return {
    latestRevision: revisions?.[0] ?? null,
    revisions: revisions ?? [],
    builds: builds ?? [],
    deployments: deployments ?? [],
    isLoading: revisionsLoading || buildsLoading || deploymentsLoading,
  };
}
