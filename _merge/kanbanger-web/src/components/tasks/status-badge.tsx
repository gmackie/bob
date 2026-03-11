"use client";

import { cn } from "@linear-clone/ui/lib/utils";

const statusConfig = {
  backlog: {
    label: "Backlog",
    color: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300",
    icon: (
      <svg className="h-3.5 w-3.5" viewBox="0 0 16 16" fill="currentColor">
        <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeWidth="2" strokeDasharray="4 2" />
      </svg>
    ),
  },
  todo: {
    label: "Todo",
    color: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300",
    icon: (
      <svg className="h-3.5 w-3.5" viewBox="0 0 16 16" fill="currentColor">
        <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeWidth="2" />
      </svg>
    ),
  },
  in_progress: {
    label: "In Progress",
    color: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300",
    icon: (
      <svg className="h-3.5 w-3.5" viewBox="0 0 16 16" fill="currentColor">
        <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeWidth="2" />
        <path d="M8 2 A6 6 0 0 1 14 8" stroke="currentColor" strokeWidth="2" fill="none" />
      </svg>
    ),
  },
  in_review: {
    label: "In Review",
    color: "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300",
    icon: (
      <svg className="h-3.5 w-3.5" viewBox="0 0 16 16" fill="currentColor">
        <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeWidth="2" />
        <path d="M8 2 A6 6 0 1 1 2 8" stroke="currentColor" strokeWidth="2" fill="none" />
      </svg>
    ),
  },
  done: {
    label: "Done",
    color: "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300",
    icon: (
      <svg className="h-3.5 w-3.5" viewBox="0 0 16 16" fill="currentColor">
        <circle cx="8" cy="8" r="6" fill="currentColor" />
        <path d="M5 8 L7 10 L11 6" stroke="white" strokeWidth="2" fill="none" />
      </svg>
    ),
  },
  canceled: {
    label: "Canceled",
    color: "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300",
    icon: (
      <svg className="h-3.5 w-3.5" viewBox="0 0 16 16" fill="currentColor">
        <circle cx="8" cy="8" r="6" fill="currentColor" />
        <path d="M5 5 L11 11 M11 5 L5 11" stroke="white" strokeWidth="2" fill="none" />
      </svg>
    ),
  },
} as const;

type TaskStatus = keyof typeof statusConfig;

interface StatusBadgeProps {
  status: TaskStatus;
  showLabel?: boolean;
  className?: string;
}

export function StatusBadge({ status, showLabel = false, className }: StatusBadgeProps) {
  const config = statusConfig[status];

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-xs font-medium",
        config.color,
        className
      )}
    >
      {config.icon}
      {showLabel && <span>{config.label}</span>}
    </span>
  );
}

export function StatusIcon({ status, className }: { status: TaskStatus; className?: string }) {
  const config = statusConfig[status];
  return <span className={cn("inline-flex", className)}>{config.icon}</span>;
}

export { statusConfig, type TaskStatus };
