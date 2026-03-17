"use client";

import { useCallback, useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  MagnifyingGlassIcon,
} from "@radix-ui/react-icons";

import { cn } from "@bob/ui";

import { ChatPanel } from "~/components/chat/chat-panel";
import { ChatPanelProvider } from "~/components/chat/chat-panel-provider";
import {
  NotificationPanel,
  useUnreadCount,
} from "~/components/notifications/notification-panel";
import { SearchProvider, useSearch } from "~/components/search/search-provider";

import { SidebarNav, NotificationButton } from "./sidebar-nav";

const SIDEBAR_EXPANDED_WIDTH = 240;
const SIDEBAR_COLLAPSED_WIDTH = 56;
const STORAGE_KEY = "bob:sidebar-collapsed";

/** Routes where sidebar auto-collapses to icon-only and content takes full width. */
const FULL_BLEED_ROUTES = ["/chat"];

function isFullBleed(pathname: string) {
  return FULL_BLEED_ROUTES.some(
    (r) => pathname === r || pathname.startsWith(r + "/"),
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <ChatPanelProvider>
      <SearchProvider>
        <AppShellInner>{children}</AppShellInner>
      </SearchProvider>
    </ChatPanelProvider>
  );
}

function AppShellInner({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() ?? "";
  const fullBleed = isFullBleed(pathname);
  const { open: openSearch } = useSearch();
  const unreadCount = useUnreadCount();
  const [notifOpen, setNotifOpen] = useState(false);

  const [userCollapsed, setUserCollapsed] = useState(() => {
    if (typeof window === "undefined") return false;
    return localStorage.getItem(STORAGE_KEY) === "true";
  });

  const collapsed = fullBleed || userCollapsed;

  const toggle = useCallback(() => {
    setUserCollapsed((prev) => {
      const next = !prev;
      localStorage.setItem(STORAGE_KEY, String(next));
      return next;
    });
  }, []);

  // Cmd+B to toggle sidebar
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.metaKey && e.key === "b" && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        toggle();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [toggle]);

  const sidebarWidth = collapsed
    ? SIDEBAR_COLLAPSED_WIDTH
    : SIDEBAR_EXPANDED_WIDTH;

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      {/* Sidebar */}
      <aside
        className="flex shrink-0 flex-col border-r border-sidebar-border bg-sidebar transition-[width] duration-200"
        style={{ width: sidebarWidth }}
      >
        {/* Logo / brand */}
        <div
          className={cn(
            "flex h-14 items-center border-b border-sidebar-border px-4",
            collapsed && "justify-center px-0",
          )}
        >
          {collapsed ? (
            <span className="font-display text-lg font-bold text-foreground">B</span>
          ) : (
            <span className="font-display text-sm font-semibold tracking-wide text-foreground">
              Bob Builder
            </span>
          )}
        </div>

        {/* Nav items */}
        <SidebarNav collapsed={collapsed} />

        {/* Bottom section */}
        <div className="border-t border-sidebar-border px-2 py-2">
          {/* Search button */}
          <button
            onClick={openSearch}
            className={cn(
              "flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground",
              collapsed && "justify-center px-0",
            )}
            title={collapsed ? "Search (⌘K)" : undefined}
          >
            <MagnifyingGlassIcon className="size-[15px] shrink-0" />
            {!collapsed && <span>Search</span>}
            {!collapsed && (
              <kbd className="ml-auto rounded border border-border px-1 py-0.5 text-[10px] text-muted-foreground">
                ⌘K
              </kbd>
            )}
          </button>

          <div className="relative">
            <NotificationButton
              collapsed={collapsed}
              unreadCount={unreadCount}
              onClick={() => setNotifOpen((o) => !o)}
            />
            <NotificationPanel
              open={notifOpen}
              onClose={() => setNotifOpen(false)}
            />
          </div>

          {/* Collapse toggle */}
          {!fullBleed && (
            <button
              onClick={toggle}
              className={cn(
                "mt-1 flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground",
                collapsed && "justify-center px-0",
              )}
              title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            >
              {collapsed ? (
                <ChevronRightIcon className="size-[15px]" />
              ) : (
                <>
                  <ChevronLeftIcon className="size-[15px]" />
                  <span>Collapse</span>
                </>
              )}
            </button>
          )}
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-y-auto">{children}</main>

      {/* Chat side panel */}
      <ChatPanel />
    </div>
  );
}
