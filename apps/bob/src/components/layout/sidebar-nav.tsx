"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { DashboardIcon, GearIcon, BellIcon } from "@radix-ui/react-icons";
import { cn } from "@gmacko/core/ui";

export interface NavItem {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  href: string;
}

const NAV_ITEMS: NavItem[] = [
  { icon: DashboardIcon, label: "Planning", href: "/planning" },
  {
    icon: () => (
      <svg className="size-[15px]" viewBox="0 0 15 15" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
        <path d="M4.5 2C3.67 2 3 2.67 3 3.5v8c0 .83.67 1.5 1.5 1.5h6c.83 0 1.5-.67 1.5-1.5v-8c0-.83-.67-1.5-1.5-1.5h-6ZM5 5h5v1H5V5Zm0 2.5h5v1H5v-1Zm0 2.5h3v1H5V10Z" />
      </svg>
    ),
    label: "Runs",
    href: "/runs",
  },
  {
    icon: () => (
      <svg className="size-[15px]" viewBox="0 0 15 15" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
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
      <svg className="size-[15px]" viewBox="0 0 15 15" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
        <rect x="2" y="4" width="11" height="8" rx="1" stroke="currentColor" strokeWidth="1" fill="none" />
        <circle cx="5" cy="8" r="1" />
        <circle cx="7.5" cy="8" r="1" />
        <circle cx="10" cy="8" r="1" />
        <path d="M5 4V2.5" stroke="currentColor" strokeWidth="1" />
        <path d="M10 4V2.5" stroke="currentColor" strokeWidth="1" />
      </svg>
    ),
    label: "Nodes",
    href: "/nodes",
  },
  { icon: GearIcon, label: "Settings", href: "/settings" },
];

interface SidebarNavProps {
  collapsed: boolean;
}

export function SidebarNav({ collapsed }: SidebarNavProps) {
  const pathname = usePathname() ?? "";
  return (
    <nav className="flex flex-1 flex-col gap-1 px-2 py-3">
      {NAV_ITEMS.map((item) => {
        const isActive =
          pathname === item.href || pathname.startsWith(item.href + "/");
        const Icon = item.icon;

        return (
          <Link
            key={item.href}
            href={item.href}
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
