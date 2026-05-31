"use client";

import { useCallback, useEffect, useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useSessionSocket } from "~/hooks/use-session-socket";
import { useTRPC } from "~/trpc/react";
import { NotificationItem } from "./notification-item";

interface NotificationPanelProps {
  open: boolean;
  onClose: () => void;
}

export function NotificationPanel({ open, onClose }: NotificationPanelProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  const { data, isFetching } = useQuery(
    trpc.notification.list.queryOptions(
      { limit: 30 },
      { enabled: open, refetchInterval: open ? 30_000 : false },
    ),
  );

  const markAsRead = useMutation(
    trpc.notification.markAsRead.mutationOptions({
      onSuccess: () => {
        void queryClient.invalidateQueries({
          queryKey: trpc.notification.list.queryKey(),
        });
      },
    }),
  );

  // Close on click outside
  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        onClose();
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open, onClose]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  const items = data?.items ?? [];

  return (
    <div
      ref={panelRef}
      className="border-border bg-popover absolute bottom-12 left-2 z-50 w-80 rounded-xl border shadow-2xl"
    >
      <div className="border-border flex items-center justify-between border-b px-4 py-3">
        <h3 className="text-foreground text-sm font-semibold">Notifications</h3>
        <span className="text-muted-foreground text-xs">
          {items.filter((n: any) => !n.read).length} unread
        </span>
      </div>

      <div className="max-h-96 overflow-y-auto p-1">
        {isFetching && items.length === 0 ? (
          <div className="text-muted-foreground px-3 py-6 text-center text-sm">
            Loading...
          </div>
        ) : items.length === 0 ? (
          <div className="text-muted-foreground px-3 py-6 text-center text-sm">
            No notifications yet.
          </div>
        ) : (
          items.map((item: any) => (
            <NotificationItem
              key={item.id}
              id={item.id}
              title={item.title}
              body={item.body}
              url={item.url}
              type={item.type}
              read={item.read}
              createdAt={String(item.createdAt)}
              onMarkAsRead={(id) => markAsRead.mutate({ id })}
            />
          ))
        )}
      </div>
    </div>
  );
}

/** Hook to get unread notification count for sidebar badge */
export function useUnreadCount() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const { data } = useQuery(
    trpc.notification.list.queryOptions(
      { unreadOnly: true, limit: 50 },
      { refetchInterval: 30_000 },
    ),
  );

  const { data: gatewayInfo } = useQuery(
    trpc.session.getGatewayWebSocketUrl.queryOptions(undefined, {
      staleTime: 60_000,
    }),
  );

  const handleWorkspaceEvent = useCallback(() => {
    void queryClient.invalidateQueries({
      queryKey: trpc.notification.list.queryKey(),
    });
  }, [queryClient, trpc.notification.list]);

  const { connectionState, subscribeWorkspace, unsubscribeWorkspace } =
    useSessionSocket({
      gatewayUrl: gatewayInfo?.url ?? "",
      token: gatewayInfo?.token ?? "",
      onWorkspaceEvent: handleWorkspaceEvent,
      onStatusChange: handleWorkspaceEvent,
      enabled: Boolean(gatewayInfo?.token),
    });

  useEffect(() => {
    if (connectionState.status !== "connected") return;
    subscribeWorkspace();
    return () => unsubscribeWorkspace();
  }, [connectionState.status, subscribeWorkspace, unsubscribeWorkspace]);

  return data?.items?.length ?? 0;
}
