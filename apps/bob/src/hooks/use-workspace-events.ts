"use client";

import { useCallback, useEffect, useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { ServerSessionStatusChanged } from "@bob/ws";
import { useTRPC } from "~/trpc/react";
import {
  selectCurrentWorkspace,
  type ShellWorkspace,
} from "~/components/layout/shell-settings-model";
import { useSessionSocket } from "./use-session-socket";
import {
  shouldInvalidateForWorkspaceRealtimeMessage,
  shouldInvalidateQueryForWorkspaceEvent,
} from "./workspace-events-model";

type WorkspaceMembership = {
  workspace?: ShellWorkspace | null;
};

/**
 * Subscribes to workspace-level session status changes via the WS gateway.
 * When a session changes status (started, completed, failed, etc.), relevant
 * React Query caches are invalidated so dashboard views update instantly
 * instead of waiting for the next polling cycle.
 *
 * Mount once at the dashboard layout level.
 */
export function useWorkspaceEvents() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const searchParams = useSearchParams();

  const { data: gatewayInfo } = useQuery(
    trpc.session.getGatewayWebSocketUrl.queryOptions(undefined),
  );
  const { data: workspaceMemberships } = useQuery(
    trpc.workspace.list.queryOptions(undefined, {
      staleTime: 60_000,
      refetchInterval: 30_000,
    }),
  );
  const workspaces = useMemo(() => {
    const memberships = (workspaceMemberships ?? []) as unknown as WorkspaceMembership[];
    return memberships.flatMap((membership) =>
      membership.workspace ? [membership.workspace] : [],
    );
  }, [workspaceMemberships]);
  const currentWorkspace = selectCurrentWorkspace(
    workspaces,
    searchParams?.get("workspace") ?? null,
  );
  const workspaceId = currentWorkspace?.id;
  const invalidateShellQueries = useCallback(
    (messageType: string) => {
      if (!shouldInvalidateForWorkspaceRealtimeMessage(messageType)) return;

      queryClient.invalidateQueries({
        predicate: (query) => {
          const key = query.queryKey;
          if (!Array.isArray(key) || key.length === 0) return false;
          return shouldInvalidateQueryForWorkspaceEvent(key);
        },
      });
    },
    [queryClient],
  );

  const { connectionState, subscribeWorkspace } = useSessionSocket({
    gatewayUrl: gatewayInfo?.url ?? "",
    token: gatewayInfo?.token ?? "",
    enabled: !!gatewayInfo?.url && !!gatewayInfo?.token,
    onEvent: () => invalidateShellQueries("event"),
    onStatusChange: () => invalidateShellQueries("session_created"),
    onWorkspaceSnapshot: () => invalidateShellQueries("workspace_snapshot"),
    onWorkspaceStatusChanged: (_info: ServerSessionStatusChanged) =>
      invalidateShellQueries("session_status_changed"),
    onWorkspaceEvent: (message) => invalidateShellQueries(message.type),
  });

  useEffect(() => {
    if (connectionState.status !== "connected") return;
    subscribeWorkspace(undefined, workspaceId);
  }, [connectionState.status, subscribeWorkspace, workspaceId]);

  return { connectionState };
}
