import type { Meta, StoryObj } from "@storybook/react";

import { cn } from "@gmacko/core/ui";
import { Badge } from "@gmacko/core/ui/badge";

const meta: Meta = {
  title: "App/Kanban Board",
};

export default meta;

const PRIORITY_BORDER: Record<string, string> = {
  urgent: "border-l-rose-500",
  high: "border-l-orange-500",
  medium: "border-l-amber-500",
  low: "border-l-blue-500",
};

const DISPATCH_DOT: Record<string, string> = {
  queued: "bg-slate-400",
  blocked: "bg-amber-400",
  running: "bg-blue-400 animate-pulse",
  completed: "bg-emerald-400",
  failed: "bg-rose-400",
};

interface KanbanCardProps {
  identifier: string;
  title: string;
  kind: string;
  kindVariant: "blue" | "rose" | "purple" | "amber" | "emerald";
  priority?: string;
  dispatchStatus?: string;
}

function KanbanCard({ identifier, title, kind, kindVariant, priority, dispatchStatus }: KanbanCardProps) {
  const priorityBorder = priority ? PRIORITY_BORDER[priority] : undefined;
  return (
    <div className={cn(
      "rounded-xl border border-border bg-card px-3 py-3 transition hover:border-muted-foreground/30 hover:shadow-sm cursor-pointer",
      priorityBorder && `border-l-2 ${priorityBorder}`,
    )}>
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
          {identifier}
        </span>
        <Badge variant={kindVariant} className="text-[10px] px-1.5 py-0">
          {kind}
        </Badge>
      </div>
      <div className="mt-2 text-sm font-medium text-foreground">{title}</div>
      {dispatchStatus && (
        <div className="mt-2 flex items-center gap-1.5">
          <span className={cn("size-2 rounded-full", DISPATCH_DOT[dispatchStatus] ?? "bg-slate-400")} />
          <span className="text-[10px] text-muted-foreground">{dispatchStatus}</span>
        </div>
      )}
    </div>
  );
}

function KanbanColumn({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-border bg-secondary p-4 min-w-[200px]">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-display text-sm font-semibold text-foreground">{title}</h3>
        <span className="rounded-full bg-accent px-2 py-0.5 text-xs text-muted-foreground">{count}</span>
      </div>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

export const Default: StoryObj = {
  render: () => (
    <div className="grid grid-cols-5 gap-4 min-w-[1100px]">
      <KanbanColumn title="Backlog" count={2}>
        <KanbanCard identifier="WI-0023" title="Add rate limiting to API gateway" kind="Feature" kindVariant="blue" priority="low" />
        <KanbanCard identifier="WI-0024" title="Update error page copy" kind="Chore" kindVariant="amber" />
      </KanbanColumn>
      <KanbanColumn title="Ready" count={1}>
        <KanbanCard identifier="WI-0019" title="Fix auth token refresh race condition" kind="Bug" kindVariant="rose" priority="high" dispatchStatus="blocked" />
      </KanbanColumn>
      <KanbanColumn title="In Progress" count={2}>
        <KanbanCard identifier="WI-0016" title="Migrate DB schema for work item priorities" kind="Task" kindVariant="purple" priority="urgent" dispatchStatus="running" />
        <KanbanCard identifier="WI-0018" title="Build pipeline timeline view" kind="Feature" kindVariant="blue" priority="medium" dispatchStatus="running" />
      </KanbanColumn>
      <KanbanColumn title="In Review" count={1}>
        <KanbanCard identifier="WI-0015" title="tRPC batch endpoint support" kind="Feature" kindVariant="blue" priority="high" dispatchStatus="completed" />
      </KanbanColumn>
      <KanbanColumn title="Done" count={1}>
        <KanbanCard identifier="WI-0012" title="Setup project card component" kind="Task" kindVariant="purple" priority="medium" dispatchStatus="completed" />
      </KanbanColumn>
    </div>
  ),
};

export const EmptyColumn: StoryObj = {
  render: () => (
    <KanbanColumn title="In Review" count={0}>
      <div className="rounded-xl border border-dashed border-border px-3 py-6 text-center text-xs text-muted-foreground">
        No items
      </div>
    </KanbanColumn>
  ),
};

export const SingleCard: StoryObj = {
  render: () => (
    <div className="w-64">
      <KanbanCard
        identifier="WI-0016"
        title="Migrate DB schema for work item priorities"
        kind="Task"
        kindVariant="purple"
        priority="urgent"
        dispatchStatus="running"
      />
    </div>
  ),
};
