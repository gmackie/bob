"use client";

import { useEffect, useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useBobRpcClient } from "~/rpc/react";

import { NotificationItem } from "./notification-item";

interface NotificationRecord {
  id: string;
  title: string;
  body?: string | null;
  url?: string | null;
  type: string;
  read: boolean;
  createdAt: string;
}

interface NotificationPanelProps {
  open: boolean;
  onClose: () => void;
  /** When true, renders as a fixed right-side drawer (shell). Default: floating card. */
  sideDrawer?: boolean;
}

export function NotificationPanel({
  open,
  onClose,
  sideDrawer = false,
}: NotificationPanelProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const rpc = useBobRpcClient();
  const queryClient = useQueryClient();
  const listInput = { limit: 30, unreadOnly: false };

  const { data, isFetching } = useQuery({
    queryKey: ["rpc", "workItem.notification.list", listInput],
    queryFn: () =>
      rpc.workItems.notification.list(listInput) as Promise<{
        items: NotificationRecord[];
      }>,
    enabled: open,
    refetchInterval: open ? 30_000 : false,
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({
      queryKey: ["rpc", "workItem.notification.list"],
    });
  };

  const markAsRead = useMutation({
    mutationFn: (input: { id: string }) =>
      rpc.workItems.notification.markAsRead(input),
    onSuccess: invalidate,
  });

  const markAllAsRead = useMutation({
    mutationFn: () =>
      rpc.workItems.notification.markAllAsRead({}) as Promise<{
        count: number;
      }>,
    onSuccess: invalidate,
  });

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
  const unreadCount = items.filter((n) => !n.read).length;

  const shell = (
    <>
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div>
          <h3 className="text-sm font-semibold text-foreground">Notifications</h3>
          <p className="text-xs text-muted-foreground">
            {unreadCount === 0
              ? "All caught up"
              : `${unreadCount} unread`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {unreadCount > 0 && (
            <button
              type="button"
              onClick={() => markAllAsRead.mutate()}
              disabled={markAllAsRead.isPending}
              className="rounded px-2 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50"
            >
              Mark all read
            </button>
          )}
          {sideDrawer && (
            <button
              type="button"
              onClick={onClose}
              className="rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              aria-label="Close notifications"
            >
              ×
            </button>
          )}
        </div>
      </div>

      <div
        className={
          sideDrawer
            ? "flex-1 overflow-y-auto p-1"
            : "max-h-96 overflow-y-auto p-1"
        }
      >
        {isFetching && items.length === 0 ? (
          <div className="px-3 py-6 text-center text-sm text-muted-foreground">
            Loading...
          </div>
        ) : items.length === 0 ? (
          <div className="px-3 py-6 text-center text-sm text-muted-foreground">
            No notifications yet.
          </div>
        ) : (
          items.map((item) => (
            <NotificationItem
              key={item.id}
              id={item.id}
              title={item.title}
              body={item.body ?? null}
              url={item.url ?? null}
              type={item.type}
              read={item.read}
              createdAt={String(item.createdAt)}
              onMarkAsRead={(id) => markAsRead.mutate({ id })}
            />
          ))
        )}
      </div>
    </>
  );

  if (sideDrawer) {
    return (
      <div
        ref={panelRef}
        className="fixed inset-y-0 right-0 z-40 flex w-80 flex-col border-l border-border bg-background shadow-2xl"
      >
        {shell}
      </div>
    );
  }

  return (
    <div
      ref={panelRef}
      className="absolute bottom-12 left-2 z-50 w-80 rounded-xl border border-border bg-popover shadow-2xl"
    >
      {shell}
    </div>
  );
}

/** Hook to get unread notification count for sidebar badge */
export function useUnreadCount() {
  const rpc = useBobRpcClient();
  const input = { unreadOnly: true, limit: 50 };
  const { data } = useQuery({
    queryKey: ["rpc", "workItem.notification.list", input],
    queryFn: () =>
      rpc.workItems.notification.list(input) as Promise<{
        items: NotificationRecord[];
      }>,
    refetchInterval: 30_000,
  });
  return data?.items?.length ?? 0;
}
