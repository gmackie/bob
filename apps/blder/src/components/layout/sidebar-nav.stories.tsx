import type { Meta, StoryObj } from "@storybook/react";
import { ChatBubbleIcon, DashboardIcon, GearIcon } from "@radix-ui/react-icons";

import { cn } from "@bob/ui";

interface NavItemDemoProps {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  isActive?: boolean;
  badge?: number;
  collapsed?: boolean;
}

function NavItemDemo({
  icon: Icon,
  label,
  isActive,
  badge,
  collapsed,
}: NavItemDemoProps) {
  return (
    <div
      className={cn(
        "flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
        isActive
          ? "bg-sidebar-accent text-sidebar-accent-foreground"
          : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
        collapsed && "justify-center px-0",
      )}
    >
      <Icon className="size-[15px] shrink-0" />
      {!collapsed && <span>{label}</span>}
      {!collapsed && badge !== undefined && badge > 0 && (
        <span className="bg-sidebar-accent text-muted-foreground ml-auto rounded-full px-1.5 py-0.5 text-[10px]">
          {badge}
        </span>
      )}
    </div>
  );
}

function SidebarDemo({ collapsed = false }: { collapsed?: boolean }) {
  return (
    <div
      className={cn(
        "bg-sidebar border-sidebar-border flex flex-col rounded-lg border-r",
        collapsed ? "w-14" : "w-60",
      )}
    >
      <div
        className={cn(
          "border-sidebar-border flex h-14 items-center border-b px-4",
          collapsed && "justify-center px-0",
        )}
      >
        {collapsed ? (
          <span className="font-display text-foreground text-lg font-bold">
            B
          </span>
        ) : (
          <span className="font-display text-foreground text-sm font-semibold tracking-wide">
            BizPulse
          </span>
        )}
      </div>
      <nav className="flex flex-1 flex-col gap-1 px-2 py-3">
        <NavItemDemo
          icon={DashboardIcon}
          label="Planning"
          isActive
          badge={3}
          collapsed={collapsed}
        />
        <NavItemDemo icon={ChatBubbleIcon} label="Chat" collapsed={collapsed} />
        <NavItemDemo icon={GearIcon} label="System" collapsed={collapsed} />
        <NavItemDemo icon={GearIcon} label="Settings" collapsed={collapsed} />
      </nav>
    </div>
  );
}

const meta: Meta = {
  title: "App/Sidebar Navigation",
};

export default meta;

export const Expanded: StoryObj = {
  render: () => <SidebarDemo />,
};

export const Collapsed: StoryObj = {
  render: () => <SidebarDemo collapsed />,
};

export const SideBySide: StoryObj = {
  render: () => (
    <div className="flex gap-8">
      <SidebarDemo />
      <SidebarDemo collapsed />
    </div>
  ),
};
