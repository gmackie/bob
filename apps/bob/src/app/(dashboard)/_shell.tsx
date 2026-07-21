"use client";

import { useCallback, useEffect, useState } from "react";
import { ChevronLeftIcon, ChevronRightIcon } from "@radix-ui/react-icons";

import { SidebarNav, NotificationButton } from "~/components/layout/sidebar-nav";
import { ShellSettingsMenu } from "~/components/layout/shell-settings-menu";
import { getShellRealtimeStatusModel } from "~/components/layout/shell-status-model";
import {
  NotificationPanel,
  useUnreadCount,
} from "~/components/notifications/notification-panel";
import { ChatPanelProvider } from "~/components/chat/chat-panel-provider";
import { ChatPanel } from "~/components/chat/chat-panel";
import { useWorkspaceEvents } from "~/hooks/use-workspace-events";

const SIDEBAR_EXPANDED_WIDTH = 240;
const SIDEBAR_COLLAPSED_WIDTH = 56;
const STORAGE_KEY = "bob:sidebar-collapsed";

export default function BilderShell({ children }: { children: React.ReactNode }) {
  const { connectionState } = useWorkspaceEvents();
  const realtimeStatus = getShellRealtimeStatusModel(connectionState.status);
  const [showNotif, setShowNotif] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const unreadCount = useUnreadCount();

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
                  realtimeStatus.tone === "success"
                    ? "bg-emerald-500"
                    : realtimeStatus.tone === "warning"
                      ? "bg-amber-500 animate-pulse"
                      : "bg-muted-foreground/40"
                }`}
                title={realtimeStatus.detail}
              />
              <span
                className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${
                  realtimeStatus.tone === "success"
                    ? "bg-emerald-500/10 text-emerald-500"
                    : realtimeStatus.tone === "warning"
                      ? "bg-amber-500/10 text-amber-500"
                      : "bg-muted text-muted-foreground"
                }`}
                title={realtimeStatus.detail}
              >
                {realtimeStatus.label}
              </span>
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
        <ShellSettingsMenu />
        {children}
      </main>

      <ChatPanel />

      <NotificationPanel
        open={showNotif}
        onClose={() => setShowNotif(false)}
        sideDrawer
      />
    </div>
    </ChatPanelProvider>
  );
}
