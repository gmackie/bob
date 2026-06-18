"use client";

import { useCallback, useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronLeftIcon, ChevronRightIcon, Cross2Icon } from "@radix-ui/react-icons";

import { SidebarNav, NotificationButton } from "~/components/layout/sidebar-nav";
import { ChatPanelProvider } from "~/components/chat/chat-panel-provider";
import { ChatPanel } from "~/components/chat/chat-panel";
import { useWorkspaceEvents } from "~/hooks/use-workspace-events";
import { useTRPC } from "~/trpc/react";

function formatNotificationTime(dateString: string): string {
  const diffMs = Date.now() - new Date(dateString).getTime();
  if (Number.isNaN(diffMs)) return "";
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

const SIDEBAR_EXPANDED_WIDTH = 240;
const SIDEBAR_COLLAPSED_WIDTH = 56;
const STORAGE_KEY = "bob:sidebar-collapsed";

export default function BilderShell({ children }: { children: React.ReactNode }) {
  const { connectionState } = useWorkspaceEvents();
  const pathname = usePathname() ?? "";
  const router = useRouter();
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const [showNotif, setShowNotif] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  const { data: notifications } = useQuery(
    trpc.notification.list.queryOptions(
      { unreadOnly: true, limit: 20 },
      { refetchInterval: 30_000 },
    ),
  );

  const markReadMutation = useMutation(
    trpc.notification.markAsRead.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: trpc.notification.list.queryKey() });
      },
    }),
  );

  const unreadCount = (notifications ?? []).length;

  useEffect(() => {
    try {
      setCollapsed(localStorage.getItem(STORAGE_KEY) === "1");
    } catch {}
  }, []);

  const toggle = useCallback(() => {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
      } catch {}
      return next;
    });
  }, []);

  const sidebarWidth = collapsed
    ? SIDEBAR_COLLAPSED_WIDTH
    : SIDEBAR_EXPANDED_WIDTH;

  return (
    <ChatPanelProvider>
    <div className="relative flex min-h-screen">
      <aside
        className="bg-background fixed inset-y-0 left-0 z-30 flex flex-col border-r border-border transition-all duration-200"
        style={{ width: sidebarWidth }}
      >
        <div className="flex h-14 items-center px-4">
          {!collapsed && (
            <span className="font-display text-sm font-bold tracking-tight flex items-center gap-2">
              blder.bot
              <span
                className={`size-1.5 rounded-full ${
                  connectionState.status === "connected"
                    ? "bg-emerald-500"
                    : connectionState.status === "connecting"
                      ? "bg-amber-500 animate-pulse"
                      : "bg-muted-foreground/40"
                }`}
                title={`WebSocket: ${connectionState.status}`}
              />
            </span>
          )}
          {collapsed && (
            <span className="font-display text-lg font-bold">B</span>
          )}
        </div>

        <nav className="flex-1 overflow-y-auto">
          <SidebarNav collapsed={collapsed} />
        </nav>

        <div className="flex flex-col gap-1 px-2 py-3">
          <NotificationButton
            collapsed={collapsed}
            unreadCount={unreadCount}
            onClick={() => setShowNotif((p) => !p)}
          />

          <button
            onClick={toggle}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent"
          >
            {collapsed ? (
              <ChevronRightIcon className="size-4" />
            ) : (
              <>
                <ChevronLeftIcon className="size-4" />
                <span>Collapse</span>
              </>
            )}
          </button>
        </div>
      </aside>

      <main
        id="main-content"
        className="min-h-screen flex-1 transition-all duration-200"
        style={{ marginLeft: sidebarWidth }}
      >
        {children}
      </main>

      <ChatPanel />

      {showNotif && (
        <div className="fixed inset-y-0 right-0 z-40 w-80 border-l border-border bg-background flex flex-col">
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <h3 className="font-display text-sm font-semibold">Notifications</h3>
            <button onClick={() => setShowNotif(false)} className="rounded p-1 text-muted-foreground hover:text-foreground hover:bg-accent transition-colors">
              <Cross2Icon className="size-4" />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto">
            {(notifications ?? []).length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-muted-foreground">All caught up</p>
            ) : (
              <div className="divide-y divide-border">
                {(notifications as any[]).map((n: any) => (
                  <button
                    key={n.id}
                    className="flex w-full flex-col gap-1 px-4 py-3 text-left transition-colors hover:bg-accent/50"
                    onClick={() => {
                      markReadMutation.mutate({ id: n.id });
                      if (n.url) router.push(n.url);
                    }}
                  >
                    <div className="flex items-center gap-2">
                      <span className="size-1.5 shrink-0 rounded-full bg-primary" />
                      <span className="text-sm font-medium text-foreground truncate">{n.title}</span>
                    </div>
                    {n.body && (
                      <p className="pl-3.5 text-xs text-muted-foreground line-clamp-2">{n.body}</p>
                    )}
                    <span className="pl-3.5 text-[10px] text-muted-foreground/70">
                      {n.createdAt ? formatNotificationTime(n.createdAt) : ""}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
    </ChatPanelProvider>
  );
}
