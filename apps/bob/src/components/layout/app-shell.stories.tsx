import type { Meta, StoryObj } from "@storybook/react";

import {
  DashboardIcon,
  ChatBubbleIcon,
  GearIcon,
  BellIcon,
  MagnifyingGlassIcon,
  ChevronLeftIcon,
} from "@radix-ui/react-icons";

import { cn } from "@bob/ui";
import { Badge } from "@bob/ui/badge";
import { Button } from "@bob/ui/button";

const meta: Meta = {
  title: "App/App Shell",
  parameters: { layout: "fullscreen" },
};

export default meta;

function SidebarItem({ icon: Icon, label, active, badge, collapsed }: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  active?: boolean;
  badge?: number;
  collapsed?: boolean;
}) {
  return (
    <div className={cn(
      "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors cursor-pointer",
      active ? "bg-sidebar-accent text-sidebar-accent-foreground" : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
      collapsed && "justify-center px-0",
    )}>
      <Icon className="size-[15px] shrink-0" />
      {!collapsed && <span>{label}</span>}
      {!collapsed && badge !== undefined && badge > 0 && (
        <span className="ml-auto rounded-full bg-sidebar-accent px-1.5 py-0.5 text-[10px] text-muted-foreground">{badge}</span>
      )}
    </div>
  );
}

function AppShellDemo() {
  return (
    <div className="flex h-[640px] overflow-hidden bg-background rounded-xl border border-border">
      {/* Sidebar */}
      <aside className="flex w-60 shrink-0 flex-col border-r border-sidebar-border bg-sidebar">
        <div className="flex h-14 items-center border-b border-sidebar-border px-4">
          <span className="font-display text-sm font-semibold tracking-wide text-foreground">Bob Builder</span>
        </div>

        <nav className="flex flex-1 flex-col gap-1 px-2 py-3">
          <SidebarItem icon={DashboardIcon} label="Planning" active badge={3} />
          <SidebarItem icon={ChatBubbleIcon} label="Chat" />
          <SidebarItem icon={GearIcon} label="System" />
          <SidebarItem icon={GearIcon} label="Settings" />
        </nav>

        <div className="border-t border-sidebar-border px-2 py-2">
          <div className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-muted-foreground cursor-pointer hover:bg-sidebar-accent hover:text-foreground">
            <MagnifyingGlassIcon className="size-[15px]" />
            <span>Search</span>
            <kbd className="ml-auto rounded border border-border px-1 py-0.5 text-[10px] text-muted-foreground">⌘K</kbd>
          </div>
          <div className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-muted-foreground cursor-pointer hover:bg-sidebar-accent hover:text-foreground">
            <BellIcon className="size-[15px]" />
            <span>Notifications</span>
            <span className="ml-auto size-2 rounded-full bg-blue-500" />
          </div>
          <div className="mt-1 flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-muted-foreground cursor-pointer hover:bg-sidebar-accent hover:text-sidebar-foreground">
            <ChevronLeftIcon className="size-[15px]" />
            <span>Collapse</span>
          </div>
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 overflow-y-auto">
        {/* Top bar */}
        <div className="flex items-center justify-between border-b border-border bg-card px-6 py-3">
          <nav className="flex items-center gap-1.5 text-sm">
            <span className="text-muted-foreground cursor-pointer hover:text-foreground">api-refactor</span>
            <span className="text-muted-foreground/50">›</span>
            <span className="font-medium text-foreground">Planning</span>
          </nav>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" className="font-mono text-xs">⌘K</Button>
            <Button size="sm">Start planning</Button>
          </div>
        </div>

        {/* Dispatch bar */}
        <div className="px-6 pt-4">
          <div className="flex items-center gap-3 rounded-lg border border-blue-400/30 bg-blue-500/5 px-4 py-3 text-sm">
            <span className="size-2 rounded-full bg-blue-400 animate-pulse" />
            <span>Dispatching: <strong>4</strong>/7 complete</span>
            <span className="ml-auto text-xs text-blue-400 cursor-pointer">View plan →</span>
          </div>
        </div>

        {/* Content */}
        <div className="p-6">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h1 className="font-display text-xl font-bold text-foreground">Recent Plans</h1>
              <p className="text-sm text-muted-foreground mt-1">AI-generated execution plans for your project.</p>
            </div>
          </div>

          <div className="space-y-2">
            {[
              { title: "Add priority column migration", tasks: "7 tasks", status: "4/7", dot: "bg-blue-400 animate-pulse", badge: "blue" as const },
              { title: "Batch endpoint support", tasks: "5 tasks · Completed in 8 minutes", status: "5/5", dot: "bg-emerald-400", badge: "emerald" as const },
              { title: "Fix auth token refresh", tasks: "3 tasks · 1 failed", status: "2/3", dot: "bg-rose-400", badge: "rose" as const },
            ].map((plan, i) => (
              <div key={i} className="flex items-center gap-4 rounded-xl border border-border bg-card px-5 py-4 transition hover:border-muted-foreground/30 hover:shadow-sm cursor-pointer">
                <div className="flex-1">
                  <div className="font-medium text-[15px] text-foreground">{plan.title}</div>
                  <div className="text-sm text-muted-foreground mt-0.5">{plan.tasks}</div>
                </div>
                <Badge variant={plan.badge} className="text-xs">{plan.status}</Badge>
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
    <div className="flex h-[640px] overflow-hidden bg-background rounded-xl border border-border">
      {/* Sidebar (collapsed) */}
      <aside className="flex w-14 shrink-0 flex-col items-center border-r border-sidebar-border bg-sidebar">
        <div className="flex h-14 items-center justify-center border-b border-sidebar-border w-full">
          <span className="font-display text-lg font-bold text-foreground">B</span>
        </div>
        <nav className="flex flex-1 flex-col items-center gap-1 py-3">
          <div className="rounded-lg p-2 bg-sidebar-accent text-sidebar-accent-foreground cursor-pointer"><DashboardIcon className="size-[15px]" /></div>
          <div className="rounded-lg p-2 text-sidebar-foreground cursor-pointer hover:bg-sidebar-accent"><ChatBubbleIcon className="size-[15px]" /></div>
          <div className="rounded-lg p-2 text-sidebar-foreground cursor-pointer hover:bg-sidebar-accent"><GearIcon className="size-[15px]" /></div>
        </nav>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-y-auto bg-background">
        <div className="flex items-center justify-between border-b border-border bg-card px-6 py-3">
          <span className="font-medium text-sm text-foreground">Chat</span>
        </div>
        <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
          Chat content area
        </div>
      </main>

      {/* Chat panel */}
      <aside className="flex w-[420px] shrink-0 flex-col border-l border-border bg-popover">
        <div className="flex h-12 items-center justify-between border-b border-border px-4">
          <div className="flex items-center gap-2">
            <span className="size-2 rounded-full bg-emerald-500" />
            <span className="text-sm font-medium text-foreground">Planning Session</span>
          </div>
          <button className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground">✕</button>
        </div>
        <div className="flex-1 overflow-y-auto p-4">
          <div className="mb-4 px-4 py-3">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-xs font-medium text-foreground">You</span>
              <span className="text-[10px] text-muted-foreground">2:14 PM</span>
            </div>
            <div className="text-sm text-secondary-foreground">Plan the priority migration</div>
          </div>
          <div className="mb-4 px-4 py-3 bg-accent/50 rounded-lg">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-xs font-medium text-foreground">Bob</span>
              <span className="text-[10px] text-muted-foreground">2:14 PM</span>
            </div>
            <div className="text-sm text-secondary-foreground">I'll create a plan with 7 tasks for adding priority support. Ready to dispatch?</div>
          </div>
        </div>
        <div className="border-t border-border px-3 py-2">
          <div className="flex items-center gap-2 rounded-lg border border-border bg-background px-3 py-2">
            <input readOnly placeholder="Type a message..." className="flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground" />
            <button className="rounded bg-primary px-2 py-1 text-xs font-medium text-primary-foreground">Send</button>
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
