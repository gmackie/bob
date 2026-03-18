"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  DashboardIcon,
  ChatBubbleIcon,
  GearIcon,
  BellIcon,
} from "@radix-ui/react-icons";
import { useQuery } from "@tanstack/react-query";

import { cn } from "@bob/ui";

import { useTRPC } from "~/trpc/react";

export interface NavItem {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  href: string;
  badge?: number;
}

const NAV_ITEMS: NavItem[] = [
  { icon: DashboardIcon, label: "Planning", href: "/planning" },
  { icon: ChatBubbleIcon, label: "Chat", href: "/chat" },
  {
    icon: () => (
      <svg
        className="size-[15px]"
        viewBox="0 0 15 15"
        fill="currentColor"
        xmlns="http://www.w3.org/2000/svg"
      >
        <circle cx="4.5" cy="3.5" r="1.5" />
        <circle cx="4.5" cy="11.5" r="1.5" />
        <circle cx="10.5" cy="3.5" r="1.5" />
        <rect x="4" y="5" width="1" height="5" />
        <path d="M10.5 5v2.5a2 2 0 0 1-2 2H7V8.5h1.5a1 1 0 0 0 1-1V5h1Z" />
      </svg>
    ),
    label: "Pull Requests",
    href: "/pull-requests",
  },
  {
    icon: () => (
      <svg
        className="size-[15px]"
        viewBox="0 0 15 15"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <path
          d="M2 3a1 1 0 0 1 1-1h9a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V3Zm1.5 1v2h8V4h-8Zm0 3.5v4.5h8V7.5h-8Z"
          fill="currentColor"
        />
      </svg>
    ),
    label: "System",
    href: "/system",
  },
  { icon: GearIcon, label: "Settings", href: "/settings" },
];

/** Returns the number of active (non-stopped) planning sessions. */
function useActivePlanningSessionCount(): number | undefined {
  const trpc = useTRPC();
  const { data: sessions } = useQuery(
    trpc.planSession.list.queryOptions({ limit: 10 }, { staleTime: 30_000 }),
  );

  if (!sessions) return undefined;
  return sessions.filter((s) => s.status !== "stopped").length;
}

interface SidebarNavProps {
  collapsed: boolean;
}

export function SidebarNav({ collapsed }: SidebarNavProps) {
  const pathname = usePathname() ?? "";
  const planningCount = useActivePlanningSessionCount();

  return (
    <nav className="flex flex-1 flex-col gap-1 px-2 py-3">
      {NAV_ITEMS.map((item) => {
        const isActive =
          pathname === item.href || pathname.startsWith(item.href + "/");
        const Icon = item.icon;

        // Use dynamic badge for the Planning nav item
        const badge =
          item.href === "/planning" ? planningCount : item.badge;

        return (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
              isActive
                ? "bg-sidebar-accent text-sidebar-accent-foreground"
                : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
              collapsed && "justify-center px-0",
            )}
            title={collapsed ? item.label : undefined}
          >
            <Icon className="size-[15px] shrink-0" />
            {!collapsed && <span>{item.label}</span>}
            {!collapsed && badge !== undefined && badge > 0 && (
              <span className="ml-auto rounded-full bg-sidebar-accent px-1.5 py-0.5 text-[10px] text-muted-foreground">
                {badge}
              </span>
            )}
          </Link>
        );
      })}
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
        "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-sidebar-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
        collapsed && "justify-center px-0",
      )}
      title={collapsed ? "Notifications" : undefined}
    >
      <span className="relative">
        <BellIcon className="size-[15px] shrink-0" />
        {unreadCount > 0 && (
          <span className="absolute -right-1 -top-1 size-2 rounded-full bg-blue-500" />
        )}
      </span>
      {!collapsed && <span>Notifications</span>}
      {!collapsed && unreadCount > 0 && (
        <span className="ml-auto rounded-full bg-sidebar-accent px-1.5 py-0.5 text-[10px] text-muted-foreground">
          {unreadCount}
        </span>
      )}
    </button>
  );
}
