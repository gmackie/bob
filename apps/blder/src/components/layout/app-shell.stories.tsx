import type { Meta, StoryObj } from "@storybook/react";
import {
  BellIcon,
  ChatBubbleIcon,
  ChevronLeftIcon,
  DashboardIcon,
  GearIcon,
  MagnifyingGlassIcon,
} from "@radix-ui/react-icons";

import { cn } from "@bob/ui";
import { Badge } from "@bob/ui/badge";
import { Button } from "@bob/ui/button";

const meta: Meta = {
  title: "App/App Shell",
  parameters: { layout: "fullscreen" },
};

export default meta;

function SidebarItem({
  icon: Icon,
  label,
  active,
  badge,
  collapsed,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  active?: boolean;
  badge?: number;
  collapsed?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
        active
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

function AppShellDemo() {
  return (
    <div className="bg-background border-border flex h-[640px] overflow-hidden rounded-xl border">
      {/* Sidebar */}
      <aside className="border-sidebar-border bg-sidebar flex w-60 shrink-0 flex-col border-r">
        <div className="border-sidebar-border flex h-14 items-center border-b px-4">
          <span className="font-display text-foreground text-sm font-semibold tracking-wide">
            BizPulse
          </span>
        </div>

        <nav className="flex flex-1 flex-col gap-1 px-2 py-3">
          <SidebarItem icon={DashboardIcon} label="Planning" active badge={3} />
          <SidebarItem icon={ChatBubbleIcon} label="Chat" />
          <SidebarItem icon={GearIcon} label="System" />
          <SidebarItem icon={GearIcon} label="Settings" />
        </nav>

        <div className="border-sidebar-border border-t px-2 py-2">
          <div className="text-muted-foreground hover:bg-sidebar-accent hover:text-foreground flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-sm">
            <MagnifyingGlassIcon className="size-[15px]" />
            <span>Search</span>
            <kbd className="border-border text-muted-foreground ml-auto rounded border px-1 py-0.5 text-[10px]">
              ⌘K
            </kbd>
          </div>
          <div className="text-muted-foreground hover:bg-sidebar-accent hover:text-foreground flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-sm">
            <BellIcon className="size-[15px]" />
            <span>Notifications</span>
            <span className="ml-auto size-2 rounded-full bg-blue-500" />
          </div>
          <div className="text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground mt-1 flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-sm">
            <ChevronLeftIcon className="size-[15px]" />
            <span>Collapse</span>
          </div>
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 overflow-y-auto">
        {/* Top bar */}
        <div className="border-border bg-card flex items-center justify-between border-b px-6 py-3">
          <nav className="flex items-center gap-1.5 text-sm">
            <span className="text-muted-foreground hover:text-foreground cursor-pointer">
              api-refactor
            </span>
            <span className="text-muted-foreground/50">›</span>
            <span className="text-foreground font-medium">Planning</span>
          </nav>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" className="font-mono text-xs">
              ⌘K
            </Button>
            <Button size="sm">Start planning</Button>
          </div>
        </div>

        {/* Dispatch bar */}
        <div className="px-6 pt-4">
          <div className="flex items-center gap-3 rounded-lg border border-blue-400/30 bg-blue-500/5 px-4 py-3 text-sm">
            <span className="size-2 animate-pulse rounded-full bg-blue-400" />
            <span>
              Dispatching: <strong>4</strong>/7 complete
            </span>
            <span className="ml-auto cursor-pointer text-xs text-blue-400">
              View plan →
            </span>
          </div>
        </div>

        {/* Content */}
        <div className="p-6">
          <div className="mb-6 flex items-center justify-between">
            <div>
              <h1 className="font-display text-foreground text-xl font-bold">
                Recent Plans
              </h1>
              <p className="text-muted-foreground mt-1 text-sm">
                AI-generated execution plans for your project.
              </p>
            </div>
          </div>

          <div className="space-y-2">
            {[
              {
                title: "Add priority column migration",
                tasks: "7 tasks",
                status: "4/7",
                dot: "bg-blue-400 animate-pulse",
                badge: "blue" as const,
              },
              {
                title: "Batch endpoint support",
                tasks: "5 tasks · Completed in 8 minutes",
                status: "5/5",
                dot: "bg-emerald-400",
                badge: "emerald" as const,
              },
              {
                title: "Fix auth token refresh",
                tasks: "3 tasks · 1 failed",
                status: "2/3",
                dot: "bg-rose-400",
                badge: "rose" as const,
              },
            ].map((plan, i) => (
              <div
                key={i}
                className="border-border bg-card hover:border-muted-foreground/30 flex cursor-pointer items-center gap-4 rounded-xl border px-5 py-4 transition hover:shadow-sm"
              >
                <div className="flex-1">
                  <div className="text-foreground text-[15px] font-medium">
                    {plan.title}
                  </div>
                  <div className="text-muted-foreground mt-0.5 text-sm">
                    {plan.tasks}
                  </div>
                </div>
                <Badge variant={plan.badge} className="text-xs">
                  {plan.status}
                </Badge>
                <span className={cn("size-2 rounded-full", plan.dot)} />
              </div>
            ))}
          </div>
        </div>
      </main>
    </div>
  );
}

function AppShellWithChatDemo() {
  return (
    <div className="bg-background border-border flex h-[640px] overflow-hidden rounded-xl border">
      {/* Sidebar (collapsed) */}
      <aside className="border-sidebar-border bg-sidebar flex w-14 shrink-0 flex-col items-center border-r">
        <div className="border-sidebar-border flex h-14 w-full items-center justify-center border-b">
          <span className="font-display text-foreground text-lg font-bold">
            B
          </span>
        </div>
        <nav className="flex flex-1 flex-col items-center gap-1 py-3">
          <div className="bg-sidebar-accent text-sidebar-accent-foreground cursor-pointer rounded-lg p-2">
            <DashboardIcon className="size-[15px]" />
          </div>
          <div className="text-sidebar-foreground hover:bg-sidebar-accent cursor-pointer rounded-lg p-2">
            <ChatBubbleIcon className="size-[15px]" />
          </div>
          <div className="text-sidebar-foreground hover:bg-sidebar-accent cursor-pointer rounded-lg p-2">
            <GearIcon className="size-[15px]" />
          </div>
        </nav>
      </aside>

      {/* Main content */}
      <main className="bg-background flex-1 overflow-y-auto">
        <div className="border-border bg-card flex items-center justify-between border-b px-6 py-3">
          <span className="text-foreground text-sm font-medium">Chat</span>
        </div>
        <div className="text-muted-foreground flex h-full items-center justify-center text-sm">
          Chat content area
        </div>
      </main>

      {/* Chat panel */}
      <aside className="border-border bg-popover flex w-[420px] shrink-0 flex-col border-l">
        <div className="border-border flex h-12 items-center justify-between border-b px-4">
          <div className="flex items-center gap-2">
            <span className="size-2 rounded-full bg-emerald-500" />
            <span className="text-foreground text-sm font-medium">
              Planning Session
            </span>
          </div>
          <button className="text-muted-foreground hover:bg-accent hover:text-foreground rounded p-1">
            ✕
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-4">
          <div className="mb-4 px-4 py-3">
            <div className="mb-1 flex items-center gap-2">
              <span className="text-foreground text-xs font-medium">You</span>
              <span className="text-muted-foreground text-[10px]">2:14 PM</span>
            </div>
            <div className="text-secondary-foreground text-sm">
              Plan the priority migration
            </div>
          </div>
          <div className="bg-accent/50 mb-4 rounded-lg px-4 py-3">
            <div className="mb-1 flex items-center gap-2">
              <span className="text-foreground text-xs font-medium">Bob</span>
              <span className="text-muted-foreground text-[10px]">2:14 PM</span>
            </div>
            <div className="text-secondary-foreground text-sm">
              I'll create a plan with 7 tasks for adding priority support. Ready
              to dispatch?
            </div>
          </div>
        </div>
        <div className="border-border border-t px-3 py-2">
          <div className="border-border bg-background flex items-center gap-2 rounded-lg border px-3 py-2">
            <input
              readOnly
              placeholder="Type a message..."
              className="text-foreground placeholder:text-muted-foreground flex-1 bg-transparent text-sm outline-none"
            />
            <button className="bg-primary text-primary-foreground rounded px-2 py-1 text-xs font-medium">
              Send
            </button>
          </div>
        </div>
      </aside>
    </div>
  );
}

export const PlanningView: StoryObj = {
  parameters: { layout: "padded" },
  render: () => <AppShellDemo />,
};

export const WithChatPanel: StoryObj = {
  parameters: { layout: "padded" },
  render: () => <AppShellWithChatDemo />,
};
