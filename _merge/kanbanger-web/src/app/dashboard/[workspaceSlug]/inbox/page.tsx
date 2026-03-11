"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { api } from "@/lib/trpc/client";
import { Button } from "@linear-clone/ui/components/button";
import { Avatar, AvatarFallback, AvatarImage } from "@linear-clone/ui/components/avatar";
import { Tabs, TabsList, TabsTrigger } from "@linear-clone/ui/components/tabs";
import { cn } from "@linear-clone/ui/lib/utils";
import {
  Inbox,
  Bell,
  CheckCheck,
  Archive,
  Circle,
  UserPlus,
  MessageSquare,
  ArrowRightCircle,
  RefreshCw,
  AtSign,
} from "lucide-react";

type NotificationType =
  | "issue_assigned"
  | "issue_mentioned"
  | "issue_commented"
  | "issue_status_changed"
  | "project_update"
  | "cycle_started"
  | "cycle_ended";

interface Notification {
  id: string;
  type: NotificationType;
  title: string;
  body: string | null;
  url: string | null;
  read: boolean;
  createdAt: Date;
  actor: {
    id: string;
    name: string | null;
    email: string;
    avatarUrl: string | null;
  } | null;
  issue: {
    id: string;
    identifier: string;
    title: string;
    status: string;
  } | null;
}

function getNotificationIcon(type: NotificationType) {
  switch (type) {
    case "issue_assigned":
      return <UserPlus className="h-4 w-4 text-blue-500" />;
    case "issue_mentioned":
      return <AtSign className="h-4 w-4 text-purple-500" />;
    case "issue_commented":
      return <MessageSquare className="h-4 w-4 text-green-500" />;
    case "issue_status_changed":
      return <ArrowRightCircle className="h-4 w-4 text-orange-500" />;
    case "cycle_started":
    case "cycle_ended":
      return <RefreshCw className="h-4 w-4 text-indigo-500" />;
    default:
      return <Bell className="h-4 w-4 text-muted-foreground" />;
  }
}

function formatTimeAgo(date: Date) {
  const now = new Date();
  const diff = now.getTime() - new Date(date).getTime();
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;
  return new Date(date).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

function NotificationItem({
  notification,
  onClick,
  onMarkAsRead,
  onArchive,
}: {
  notification: Notification;
  onClick: () => void;
  onMarkAsRead: () => void;
  onArchive: () => void;
}) {
  return (
    <div
      className={cn(
        "group flex items-start gap-3 border-b border-border p-4 transition-colors hover:bg-muted/50",
        !notification.read && "bg-primary/5"
      )}
    >
      <button
        type="button"
        onClick={onClick}
        className="flex flex-1 items-start gap-3 text-left"
      >
        {notification.actor ? (
          <Avatar className="h-8 w-8">
            <AvatarImage src={notification.actor.avatarUrl ?? ""} />
            <AvatarFallback className="text-xs">
              {notification.actor.name?.[0] ?? notification.actor.email[0]?.toUpperCase()}
            </AvatarFallback>
          </Avatar>
        ) : (
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-muted">
            {getNotificationIcon(notification.type)}
          </div>
        )}

        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <p className={cn("text-sm", !notification.read && "font-medium")}>
              {notification.title}
            </p>
            <span className="shrink-0 text-xs text-muted-foreground">
              {formatTimeAgo(notification.createdAt)}
            </span>
          </div>

          {notification.body && (
            <p className="mt-0.5 text-sm text-muted-foreground line-clamp-2">
              {notification.body}
            </p>
          )}

          {notification.issue && (
            <div className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
              <span className="font-mono">{notification.issue.identifier}</span>
              <span className="truncate">{notification.issue.title}</span>
            </div>
          )}
        </div>

        {!notification.read && (
          <div className="mt-1">
            <Circle className="h-2 w-2 fill-primary text-primary" />
          </div>
        )}
      </button>

      <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
        {!notification.read && (
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={(e) => {
              e.stopPropagation();
              onMarkAsRead();
            }}
            title="Mark as read"
          >
            <CheckCheck className="h-3.5 w-3.5" />
          </Button>
        )}
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={(e) => {
            e.stopPropagation();
            onArchive();
          }}
          title="Archive"
        >
          <Archive className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}

export default function InboxPage() {
  const params = useParams();
  const router = useRouter();
  const workspaceSlug = params.workspaceSlug as string;

  const [filter, setFilter] = useState<"all" | "unread">("all");

  const { data, isLoading } = api.notification.list.useQuery({
    unreadOnly: filter === "unread",
    limit: 50,
  });

  const utils = api.useUtils();

  const markAsReadMutation = api.notification.markAsRead.useMutation({
    onSuccess: () => {
      utils.notification.list.invalidate();
      utils.notification.unreadCount.invalidate();
    },
  });

  const markAllAsReadMutation = api.notification.markAllAsRead.useMutation({
    onSuccess: () => {
      utils.notification.list.invalidate();
      utils.notification.unreadCount.invalidate();
    },
  });

  const archiveMutation = api.notification.archive.useMutation({
    onSuccess: () => {
      utils.notification.list.invalidate();
      utils.notification.unreadCount.invalidate();
    },
  });

  const archiveAllReadMutation = api.notification.archiveAllRead.useMutation({
    onSuccess: () => {
      utils.notification.list.invalidate();
    },
  });

  const handleNotificationClick = (notification: Notification) => {
    if (!notification.read) {
      markAsReadMutation.mutate({ id: notification.id });
    }

    if (notification.issue) {
      router.push(`/dashboard/${workspaceSlug}/tasks/all?issue=${notification.issue.id}`);
    } else if (notification.url) {
      router.push(notification.url);
    }
  };

  const notifications = data?.notifications ?? [];
  const unreadCount = data?.unreadCount ?? 0;

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-border px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10">
              <Inbox className="h-5 w-5 text-primary" />
            </div>
            <div>
              <h1 className="text-xl font-semibold">Inbox</h1>
              <p className="text-sm text-muted-foreground">
                {unreadCount > 0
                  ? `${unreadCount} unread notification${unreadCount !== 1 ? "s" : ""}`
                  : "All caught up!"}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {unreadCount > 0 && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => markAllAsReadMutation.mutate()}
                disabled={markAllAsReadMutation.isPending}
              >
                <CheckCheck className="mr-1 h-4 w-4" />
                Mark all read
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => archiveAllReadMutation.mutate()}
              disabled={archiveAllReadMutation.isPending}
            >
              <Archive className="mr-1 h-4 w-4" />
              Archive read
            </Button>
          </div>
        </div>

        <Tabs
          value={filter}
          onValueChange={(v) => setFilter(v as "all" | "unread")}
          className="mt-4"
        >
          <TabsList>
            <TabsTrigger value="all">
              All
              {notifications.length > 0 && (
                <span className="ml-1.5 text-xs">({notifications.length})</span>
              )}
            </TabsTrigger>
            <TabsTrigger value="unread">
              Unread
              {unreadCount > 0 && (
                <span className="ml-1.5 text-xs">({unreadCount})</span>
              )}
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      <div className="flex-1 overflow-auto">
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
          </div>
        ) : notifications.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
              <Inbox className="h-6 w-6 text-muted-foreground" />
            </div>
            <h3 className="mt-4 font-medium">
              {filter === "unread" ? "No unread notifications" : "No notifications yet"}
            </h3>
            <p className="mt-1 text-sm text-muted-foreground">
              {filter === "unread"
                ? "You've read all your notifications."
                : "Notifications will appear here when you receive them."}
            </p>
          </div>
        ) : (
          <div>
            {notifications.map((notification) => (
              <NotificationItem
                key={notification.id}
                notification={notification as Notification}
                onClick={() => handleNotificationClick(notification as Notification)}
                onMarkAsRead={() => markAsReadMutation.mutate({ id: notification.id })}
                onArchive={() => archiveMutation.mutate({ id: notification.id })}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
