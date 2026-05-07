"use client";

import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { ServerSessionStatusChanged } from "@bob/ws";
import { useTRPC } from "~/trpc/react";
import { useSessionSocket } from "./use-session-socket";

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

  const { data: gatewayInfo } = useQuery(
    trpc.session.getGatewayWebSocketUrl.queryOptions(undefined),
  );

  const { connectionState, subscribeWorkspace } = useSessionSocket({
    gatewayUrl: gatewayInfo?.url ?? "",
    token: gatewayInfo?.userId ?? "",
    enabled: !!gatewayInfo?.url,
    onWorkspaceStatusChanged: (_info: ServerSessionStatusChanged) => {
      queryClient.invalidateQueries({
        predicate: (query) => {
          const key = query.queryKey;
          if (!Array.isArray(key) || key.length === 0) return false;
          const path = Array.isArray(key[0]) ? key[0] : key;
          const root = typeof path[0] === "string" ? path[0] : "";
          return (
            root === "dispatch" ||
            root === "workItems" ||
            root === "activity" ||
            root === "session" ||
            root === "workspace"
          );
        },
      });
    },
  });

  useEffect(() => {
    if (connectionState.status !== "connected") return;
    subscribeWorkspace();
  }, [connectionState.status, subscribeWorkspace]);

  return { connectionState };
}
