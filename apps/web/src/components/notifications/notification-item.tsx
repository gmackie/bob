"use client";

import Link from "next/link";

import { cn } from "@bob/ui";

import { formatRelativeTime } from "~/lib/format/time";

interface NotificationItemProps {
  id: string;
  title: string;
  body: string | null;
  url: string | null;
  type: string;
  read: boolean;
  createdAt: string;
  onMarkAsRead: (id: string) => void;
}

export function NotificationItem({
  id,
  title,
  body,
  url,
  read,
  createdAt,
  onMarkAsRead,
}: NotificationItemProps) {
  const content = (
    <div
      className={cn(
        "rounded-lg px-3 py-2.5 transition-colors hover:bg-white/5",
        !read && "bg-white/[0.03]",
      )}
    >
      <div className="flex items-start gap-2">
        {!read && (
          <span className="mt-1.5 size-2 shrink-0 rounded-full bg-blue-500" />
        )}
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium text-white/80">{title}</div>
          {body && (
            <div className="mt-0.5 truncate text-xs text-white/45">
              {body}
            </div>
          )}
          <div className="mt-1 text-[10px] text-white/30">
            {formatRelativeTime(createdAt)}
          </div>
        </div>
        {!read && (
          <button
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onMarkAsRead(id);
            }}
            className="shrink-0 rounded px-1.5 py-0.5 text-[10px] text-white/30 transition-colors hover:bg-white/10 hover:text-white/60"
          >
            Read
          </button>
        )}
      </div>
    </div>
  );

  if (url) {
    return (
      <Link href={url} className="block">
        {content}
      </Link>
    );
  }

  return content;
}

