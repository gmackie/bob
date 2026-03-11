"use client";

import Link from "next/link";
import { cn } from "@linear-clone/ui/lib/utils";
import { StatusBadge, type TaskStatus } from "@/components/tasks/status-badge";
import { PriorityBadge, type TaskPriority } from "@/components/tasks/priority-badge";
import { formatDistanceToNow, isPast, isToday, isTomorrow } from "date-fns";

interface TaskRowProps {
  task: {
    id: string;
    identifier: string;
    title: string;
    status: string;
    priority: string;
    dueDate?: Date | string | null;
    completedAt?: Date | string | null;
    project?: {
      id: string;
      name: string;
      key: string;
      color: string | null;
    } | null;
  };
  workspaceSlug: string;
  showStatus?: boolean;
  showDueDate?: boolean;
  showCompletedAt?: boolean;
}

export function TaskRow({
  task,
  workspaceSlug,
  showStatus = true,
  showDueDate = true,
  showCompletedAt = false,
}: TaskRowProps) {
  const dueDate = task.dueDate ? new Date(task.dueDate) : null;
  const completedAt = task.completedAt ? new Date(task.completedAt) : null;

  const getDueDateDisplay = () => {
    if (!dueDate) return null;
    if (isPast(dueDate) && !isToday(dueDate)) {
      return { text: "Overdue", className: "text-red-500 bg-red-500/10" };
    }
    if (isToday(dueDate)) {
      return { text: "Today", className: "text-orange-500 bg-orange-500/10" };
    }
    if (isTomorrow(dueDate)) {
      return { text: "Tomorrow", className: "text-yellow-500 bg-yellow-500/10" };
    }
    return {
      text: formatDistanceToNow(dueDate, { addSuffix: true }),
      className: "text-muted-foreground bg-muted",
    };
  };

  const dueDateDisplay = getDueDateDisplay();

  return (
    <Link
      href={`/dashboard/${workspaceSlug}/projects/${task.project?.id}?task=${task.id}`}
      className={cn(
        "flex items-center gap-3 rounded-md px-3 py-2",
        "hover:bg-muted/50 transition-colors",
        "group cursor-pointer"
      )}
    >
      {showStatus && (
        <StatusBadge status={task.status as TaskStatus} showLabel={false} />
      )}

      <span className="font-mono text-xs text-muted-foreground min-w-[60px]">
        {task.identifier}
      </span>

      <span className="flex-1 text-sm truncate">{task.title}</span>

      {task.project && (
        <div className="flex items-center gap-1.5 shrink-0">
          <span
            className="h-2 w-2 rounded-sm"
            style={{ backgroundColor: task.project.color ?? "#6366f1" }}
          />
          <span className="text-xs text-muted-foreground max-w-[80px] truncate">
            {task.project.name}
          </span>
        </div>
      )}

      {showDueDate && dueDateDisplay && (
        <span
          className={cn(
            "text-xs px-1.5 py-0.5 rounded shrink-0",
            dueDateDisplay.className
          )}
        >
          {dueDateDisplay.text}
        </span>
      )}

      {showCompletedAt && completedAt && (
        <span className="text-xs text-muted-foreground shrink-0">
          {formatDistanceToNow(completedAt, { addSuffix: true })}
        </span>
      )}

      <PriorityBadge priority={task.priority as TaskPriority} showLabel={false} />
    </Link>
  );
}
