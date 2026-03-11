"use client";

import { cn } from "@linear-clone/ui/lib/utils";

const priorityConfig = {
  no_priority: {
    label: "No Priority",
    color: "text-gray-400",
    icon: (
      <svg className="h-4 w-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
        <line x1="3" y1="8" x2="13" y2="8" />
      </svg>
    ),
  },
  urgent: {
    label: "Urgent",
    color: "text-red-500",
    icon: (
      <svg className="h-4 w-4" viewBox="0 0 16 16" fill="currentColor">
        <rect x="2" y="3" width="3" height="10" rx="1" />
        <rect x="6.5" y="3" width="3" height="10" rx="1" />
        <rect x="11" y="3" width="3" height="10" rx="1" />
      </svg>
    ),
  },
  high: {
    label: "High",
    color: "text-orange-500",
    icon: (
      <svg className="h-4 w-4" viewBox="0 0 16 16" fill="currentColor">
        <rect x="2" y="6" width="3" height="7" rx="1" />
        <rect x="6.5" y="3" width="3" height="10" rx="1" />
        <rect x="11" y="6" width="3" height="7" rx="1" opacity="0.3" />
      </svg>
    ),
  },
  medium: {
    label: "Medium",
    color: "text-yellow-500",
    icon: (
      <svg className="h-4 w-4" viewBox="0 0 16 16" fill="currentColor">
        <rect x="2" y="8" width="3" height="5" rx="1" />
        <rect x="6.5" y="6" width="3" height="7" rx="1" />
        <rect x="11" y="8" width="3" height="5" rx="1" opacity="0.3" />
      </svg>
    ),
  },
  low: {
    label: "Low",
    color: "text-blue-500",
    icon: (
      <svg className="h-4 w-4" viewBox="0 0 16 16" fill="currentColor">
        <rect x="2" y="10" width="3" height="3" rx="1" />
        <rect x="6.5" y="10" width="3" height="3" rx="1" opacity="0.3" />
        <rect x="11" y="10" width="3" height="3" rx="1" opacity="0.3" />
      </svg>
    ),
  },
} as const;

type TaskPriority = keyof typeof priorityConfig;

interface PriorityBadgeProps {
  priority: TaskPriority;
  showLabel?: boolean;
  className?: string;
}

export function PriorityBadge({ priority, showLabel = false, className }: PriorityBadgeProps) {
  const config = priorityConfig[priority];

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 text-xs font-medium",
        config.color,
        className
      )}
    >
      {config.icon}
      {showLabel && <span>{config.label}</span>}
    </span>
  );
}

export function PriorityIcon({ priority, className }: { priority: TaskPriority; className?: string }) {
  const config = priorityConfig[priority];
  return <span className={cn("inline-flex", config.color, className)}>{config.icon}</span>;
}

export { priorityConfig, type TaskPriority };
