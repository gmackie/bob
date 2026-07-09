"use client";

import Link from "next/link";
import { useMemo } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { BellIcon } from "@radix-ui/react-icons";
import { cn } from "@gmacko/core/ui";
import {
  buildSidebarRailRows,
  buildSidebarProjectSummaries,
  getSidebarScopedHref,
  buildSidebarTabBadges,
  getSidebarActiveTabKeyForPath,
  getSidebarModeForPath,
  getSidebarModeItems,
  getSidebarModeTabs,
  getSidebarUtilityItems,
  type SidebarShellMode,
  type SidebarRailStatusTone,
  type SidebarTabBadgeInput,
  type SidebarTabBadgeKey,
  type SidebarProjectEntry,
  type SidebarUtilityItem,
} from "./sidebar-nav-model";
import {
  selectCurrentWorkspace,
  type ShellWorkspace,
} from "./shell-settings-model";
import { useTRPC } from "~/trpc/react";

export interface NavItem {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  href: string;
}

const MODE_ICON: Record<SidebarShellMode, NavItem["icon"]> = {
  tasks: () => (
    <svg className="size-[15px]" viewBox="0 0 15 15" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
      <path d="M3 3.5A1.5 1.5 0 0 1 4.5 2h6A1.5 1.5 0 0 1 12 3.5v8a1.5 1.5 0 0 1-1.5 1.5h-6A1.5 1.5 0 0 1 3 11.5v-8Zm1.5-.5a.5.5 0 0 0-.5.5v8a.5.5 0 0 0 .5.5h6a.5.5 0 0 0 .5-.5v-8a.5.5 0 0 0-.5-.5h-6ZM5 5h1v1H5V5Zm2 0h3v1H7V5ZM5 7.25h1v1H5v-1Zm2 0h3v1H7v-1ZM5 9.5h1v1H5v-1Zm2 0h3v1H7v-1Z" />
    </svg>
  ),
  planning: () => (
    <svg className="size-[15px]" viewBox="0 0 15 15" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
      <path d="M4.5 2C3.67 2 3 2.67 3 3.5v8c0 .83.67 1.5 1.5 1.5h6c.83 0 1.5-.67 1.5-1.5v-8c0-.83-.67-1.5-1.5-1.5h-6ZM5 5h5v1H5V5Zm0 2.5h5v1H5v-1Zm0 2.5h3v1H5V10Z" />
    </svg>
  ),
};

const UTILITY_ICON: Record<SidebarUtilityItem["key"], NavItem["icon"]> = {
  onboarding: () => (
    <svg className="size-[15px]" viewBox="0 0 15 15" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
      <path d="M3 2.5A1.5 1.5 0 0 1 4.5 1h6A1.5 1.5 0 0 1 12 2.5v10a1.5 1.5 0 0 1-1.5 1.5h-6A1.5 1.5 0 0 1 3 12.5v-10ZM4.5 2a.5.5 0 0 0-.5.5v10a.5.5 0 0 0 .5.5h6a.5.5 0 0 0 .5-.5v-10a.5.5 0 0 0-.5-.5h-6Z" />
      <path d="M5 4.25 6.1 5.35 8.5 3 9.2 3.7 6.1 6.75 4.3 4.95 5 4.25ZM5 8.25 6.1 9.35 8.5 7 9.2 7.7 6.1 10.75 4.3 8.95 5 8.25Z" />
    </svg>
  ),
  "pull-requests": () => (
    <svg className="size-[15px]" viewBox="0 0 15 15" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
      <circle cx="4.5" cy="3.5" r="1.5" />
      <circle cx="4.5" cy="11.5" r="1.5" />
      <circle cx="10.5" cy="3.5" r="1.5" />
      <rect x="4" y="5" width="1" height="5" />
      <path d="M10.5 5v2.5a2 2 0 0 1-2 2H7V8.5h1.5a1 1 0 0 0 1-1V5h1Z" />
    </svg>
  ),
  nodes: () => (
    <svg className="size-[15px]" viewBox="0 0 15 15" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
      <rect x="2" y="4" width="11" height="8" rx="1" stroke="currentColor" strokeWidth="1" fill="none" />
      <circle cx="5" cy="8" r="1" />
      <circle cx="7.5" cy="8" r="1" />
      <circle cx="10" cy="8" r="1" />
      <path d="M5 4V2.5" stroke="currentColor" strokeWidth="1" />
      <path d="M10 4V2.5" stroke="currentColor" strokeWidth="1" />
    </svg>
  ),
};

function TabIcon({ label }: { label: string }) {
  return (
    <span className="flex size-[15px] shrink-0 items-center justify-center rounded-sm bg-current/10 text-[10px] font-bold">
      {label.slice(0, 1)}
    </span>
  );
}

interface SidebarNavProps {
  collapsed: boolean;
}

type WorkspaceMembership = {
  workspace?: ShellWorkspace | null;
};

function BadgeCount({
  count,
  collapsed,
}: {
  count: number;
  collapsed: boolean;
}) {
  return (
    <span
      className={cn(
        "ml-auto rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-muted-foreground",
        count > 0 && "bg-primary/10 text-primary",
        collapsed && "absolute right-1 top-1 ml-0 min-w-4 text-center",
      )}
      aria-label={`${count} items`}
    >
      {count}
    </span>
  );
}

const RAIL_ROW_TONE_CLASS: Record<SidebarRailStatusTone, string> = {
  success: "bg-emerald-500",
  warning: "bg-amber-500",
  danger: "bg-rose-500",
  default: "bg-muted-foreground",
};

const RAIL_ROW_BADGE_CLASS: Record<SidebarRailStatusTone, string> = {
  success: "bg-emerald-500/10 text-emerald-500",
  warning: "bg-amber-500/10 text-amber-500",
  danger: "bg-rose-500/10 text-rose-500",
  default: "bg-muted text-muted-foreground",
};

export function SidebarNav({ collapsed }: SidebarNavProps) {
  const trpc = useTRPC();
  const pathname = usePathname() ?? "";
  const searchParams = useSearchParams();
  const mode = getSidebarModeForPath(pathname);
  const modeItems = getSidebarModeItems();
  const modeTabs = getSidebarModeTabs(mode);
  const activeTabKey = getSidebarActiveTabKeyForPath(
    pathname,
    searchParams?.toString() ?? "",
  );
  const utilityItems = getSidebarUtilityItems();
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
  const workspaceId = currentWorkspace?.id ?? "";
  const { data: workItems } = useQuery(
    trpc.workItem.list.queryOptions(
      { workspaceId, limit: 100 },
      { enabled: Boolean(workspaceId), refetchInterval: 10_000 },
    ),
  );
  const { data: executionSessions } = useQuery(
    trpc.agentRun.list.queryOptions(
      { workspaceId, limit: 50 },
      { enabled: Boolean(workspaceId), refetchInterval: 10_000 },
    ),
  );
  const { data: planningSessions } = useQuery(
    trpc.planSession.list.queryOptions(
      { workspaceId, limit: 50 },
      { enabled: Boolean(workspaceId), refetchInterval: 10_000 },
    ),
  );
  const { data: projects } = useQuery(
    trpc.project.list.queryOptions(
      { workspaceId },
      { enabled: Boolean(workspaceId), refetchInterval: 15_000 },
    ),
  );
  const tabBadges = buildSidebarTabBadges({
    workItems: (workItems ?? []) as SidebarTabBadgeInput["workItems"],
    executionSessions: (executionSessions ?? []) as SidebarTabBadgeInput["executionSessions"],
    planningSessions: (planningSessions ?? []) as SidebarTabBadgeInput["planningSessions"],
    projects: buildSidebarProjectSummaries((projects ?? []) as SidebarProjectEntry[]),
  });
  const activeTab =
    modeTabs.find((item) => item.key === activeTabKey) ?? modeTabs[0];
  const projectRows = buildSidebarProjectSummaries((projects ?? []) as SidebarProjectEntry[]);
  const railRows = activeTab
      ? buildSidebarRailRows({
        tab: activeTab.key as SidebarTabBadgeKey,
        workspaceId,
        workItems: (workItems ?? []) as SidebarTabBadgeInput["workItems"],
        executionSessions: (executionSessions ?? []) as SidebarTabBadgeInput["executionSessions"],
        planningSessions: (planningSessions ?? []) as SidebarTabBadgeInput["planningSessions"],
        projects: projectRows,
      })
    : [];

  return (
    <nav className="flex flex-1 flex-col gap-3 px-2 py-3">
      <div className="flex flex-col gap-1">
        {!collapsed && (
          <div className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            Mode
          </div>
        )}
        {modeItems.map((item) => {
          const isActive = mode === item.key;
          const Icon = MODE_ICON[item.icon];

          return (
            <Link
              key={item.key}
              href={getSidebarScopedHref(item.href, workspaceId)}
              className={cn(
                "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                isActive
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:bg-accent hover:text-foreground",
                collapsed && "justify-center px-0",
              )}
              title={collapsed ? item.label : undefined}
            >
              <Icon className="size-[15px] shrink-0" />
              {!collapsed && <span>{item.label}</span>}
            </Link>
          );
        })}
      </div>

      <div className="flex flex-col gap-1">
        {!collapsed && (
          <div className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            {mode === "tasks" ? "Tasks" : "Planning"}
          </div>
        )}
        {modeTabs.map((item) => {
          const isActive = item.key === activeTab?.key;

          return (
            <Link
              key={item.key}
              href={getSidebarScopedHref(item.href, workspaceId)}
              className={cn(
                "relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                isActive
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:bg-accent hover:text-foreground",
                collapsed && "justify-center px-0",
              )}
              title={
                collapsed
                  ? `${item.label}: ${tabBadges[item.key as SidebarTabBadgeKey]}`
                  : undefined
              }
            >
              <TabIcon label={item.label} />
              {!collapsed && <span>{item.label}</span>}
              <BadgeCount
                count={tabBadges[item.key as SidebarTabBadgeKey]}
                collapsed={collapsed}
              />
            </Link>
          );
        })}
        {!collapsed && railRows.length > 0 ? (
          <div className="mt-2 space-y-1 border-t border-border/70 pt-2">
            {railRows.map((row) => (
              <Link
                key={row.id}
                href={row.href}
                className="flex min-w-0 gap-2 rounded-lg px-2 py-2 transition-colors hover:bg-accent"
              >
                <span
                  className={cn(
                    "mt-1.5 size-1.5 shrink-0 rounded-full",
                    RAIL_ROW_TONE_CLASS[row.statusTone],
                  )}
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs font-medium text-foreground">
                    {row.title}
                  </span>
                  <span className="mt-1 flex min-w-0 items-center gap-1.5">
                    <span
                      className={cn(
                        "rounded-full px-1.5 py-0.5 text-[10px] font-semibold",
                        RAIL_ROW_BADGE_CLASS[row.statusTone],
                      )}
                    >
                      {row.statusLabel}
                    </span>
                    <span className="truncate rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground">
                      {row.agentLabel}
                    </span>
                    {row.detailLabel ? (
                      <span className="truncate rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground">
                        {row.detailLabel}
                      </span>
                    ) : null}
                    <span className="shrink-0 text-[10px] text-muted-foreground">
                      {row.lastUpdatedLabel}
                    </span>
                  </span>
                </span>
              </Link>
            ))}
          </div>
        ) : null}
      </div>

      <div className="mt-2 flex flex-col gap-1 border-t border-border pt-3">
        {!collapsed && (
          <div className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            System
          </div>
        )}
        {utilityItems.map((item) => {
        const isActive =
          pathname === item.href || pathname.startsWith(item.href + "/");
        const Icon = UTILITY_ICON[item.key];

        return (
          <Link
            key={item.href}
            href={getSidebarScopedHref(item.href, workspaceId)}
            className={cn(
              "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
              isActive
                ? "bg-primary/10 text-primary"
                : "text-muted-foreground hover:bg-accent hover:text-foreground",
              collapsed && "justify-center px-0",
            )}
            title={collapsed ? item.label : undefined}
          >
            <Icon className="size-[15px] shrink-0" />
            {!collapsed && <span>{item.label}</span>}
          </Link>
        );
      })}
      </div>
    </nav>
  );
}

interface NotificationButtonProps {
  collapsed: boolean;
  unreadCount?: number;
  onClick?: () => void;
}

export function NotificationButton({
  collapsed,
  unreadCount = 0,
  onClick,
}: NotificationButtonProps) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground",
        collapsed && "justify-center px-0",
      )}
      title={collapsed ? "Notifications" : undefined}
    >
      <span className="relative">
        <BellIcon className="size-[15px] shrink-0" />
        {unreadCount > 0 && (
          <span className="absolute -right-1 -top-1 size-2 rounded-full bg-primary" />
        )}
      </span>
      {!collapsed && <span>Notifications</span>}
    </button>
  );
}
