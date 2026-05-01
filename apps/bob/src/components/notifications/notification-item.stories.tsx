import type { Meta, StoryObj } from "@storybook/react";

import { cn } from "@gmacko/core/ui";

const meta: Meta = {
  title: "App/Notification Item",
};

export default meta;

interface NotificationDemoProps {
  title: string;
  body?: string;
  time: string;
  read?: boolean;
}

function NotificationDemo({ title, body, time, read = false }: NotificationDemoProps) {
  return (
    <div className={cn(
      "rounded-lg px-3 py-2.5 transition-colors hover:bg-accent cursor-pointer",
      !read && "bg-primary/5",
    )}>
      <div className="flex items-start gap-2">
        {!read && (
          <span className="mt-1.5 size-2 shrink-0 rounded-full bg-blue-500" />
        )}
        {read && <span className="w-2 shrink-0" />}
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium text-foreground">{title}</div>
          {body && (
            <div className="mt-0.5 truncate text-xs text-muted-foreground">{body}</div>
          )}
          <div className="mt-1 text-[10px] text-muted-foreground/70">{time}</div>
        </div>
        {!read && (
          <button className="shrink-0 rounded px-1.5 py-0.5 text-[10px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground">
            Read
          </button>
        )}
      </div>
    </div>
  );
}

export const Unread: StoryObj = {
  render: () => (
    <div className="w-96">
      <NotificationDemo title="Build passed: migrate-db-schema" body="All 3 gates passed. Ready for production deploy." time="2m ago" />
    </div>
  ),
};

export const Read: StoryObj = {
  render: () => (
    <div className="w-96">
      <NotificationDemo title="Workspace archived: old-prototype" body="Archived by system after 30 days of inactivity." time="1h ago" read />
    </div>
  ),
};

export const NotificationList: StoryObj = {
  render: () => (
    <div className="w-96 border border-border rounded-xl bg-card overflow-hidden">
      <div className="px-4 py-3 border-b border-border">
        <h3 className="font-display text-sm font-semibold text-foreground">Notifications</h3>
      </div>
      <div className="divide-y divide-border">
        <NotificationDemo title="Build passed: migrate-db-schema" body="All 3 gates passed. Ready for production deploy." time="2m ago" />
        <NotificationDemo title="Task failed: deploy-staging" body="Exit code 1. Container health check timeout after 30s." time="8m ago" />
        <NotificationDemo title="Workspace archived: old-prototype" body="Archived by system after 30 days of inactivity." time="1h ago" read />
        <NotificationDemo title='New comment on WI-0015' body='Sean: "Looks good, merging after the next gate."' time="3h ago" read />
      </div>
    </div>
  ),
};
