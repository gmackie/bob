// apps/web/src/components/review/task-selector.tsx
"use client";

import { cn } from "@gmacko/core/ui";

export interface TaskTab {
  id: string;
  label: string;
  status: "completed" | "running" | "failed" | "blocked" | "queued";
}

interface TaskSelectorProps {
  tasks: TaskTab[];
  selectedTaskId: string | null; // null = "All Tasks"
  onSelect: (taskId: string | null) => void;
}

const TAB_STATUS_ICON: Record<string, string> = {
  completed: "✓",
  running: "●",
  failed: "✕",
  blocked: "⏸",
  queued: "○",
};

const TAB_STATUS_COLOR: Record<string, string> = {
  completed: "text-emerald-600 dark:text-emerald-400",
  running: "text-amber-600 dark:text-amber-400",
  failed: "text-rose-600 dark:text-rose-400",
  blocked: "text-muted-foreground",
  queued: "text-muted-foreground",
};

export function TaskSelector({ tasks, selectedTaskId, onSelect }: TaskSelectorProps) {
  if (tasks.length <= 1) return null;

  return (
    <div className="flex items-center gap-1 overflow-x-auto border-b border-border bg-card px-6 py-2">
      <button
        type="button"
        onClick={() => onSelect(null)}
        className={cn(
          "shrink-0 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors",
          selectedTaskId === null
            ? "bg-primary/10 text-primary"
            : "text-muted-foreground hover:text-foreground",
        )}
      >
        All Tasks
      </button>
      {tasks.map((task, i) => (
        <button
          key={task.id}
          type="button"
          onClick={() => onSelect(task.id)}
          className={cn(
            "flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors",
            selectedTaskId === task.id
              ? "bg-primary/10 text-primary"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          <span className={cn("text-[10px]", TAB_STATUS_COLOR[task.status])}>
            {TAB_STATUS_ICON[task.status]}
          </span>
          Task {i + 1}: {task.label}
        </button>
      ))}
    </div>
  );
}
