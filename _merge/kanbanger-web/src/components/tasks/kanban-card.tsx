"use client";

import { memo } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Bot } from "lucide-react";
import { cn } from "@linear-clone/ui/lib/utils";
import type { TaskStatus } from "./status-badge";
import type { TaskPriority } from "./priority-badge";
import { BobTaskIndicators, type BobTaskProjection } from "./bob-task-indicators";

export interface KanbanTask {
  id: string;
  identifier: string;
  title: string;
  status: TaskStatus;
  priority: TaskPriority;
  assignee?: {
    id: string;
    name: string | null;
    avatarUrl: string | null;
    isAgent?: boolean;
  } | null;
  labels?: Array<{
    id: string;
    name: string;
    color: string;
  }>;
  project?: {
    id: string;
    name: string;
    color: string | null;
  } | null;
  dueDate?: Date | null;
  bobView?: BobTaskProjection | null;
}

interface KanbanCardProps {
  task: KanbanTask;
  onClick?: () => void;
}

function KanbanCardInner({ task, onClick }: KanbanCardProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: task.id,
    data: {
      type: "task",
      task,
    },
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      onClick={onClick}
      className={cn(
        "cursor-pointer rounded-md border border-border bg-background p-3 shadow-sm",
        "hover:border-primary/50 hover:shadow-md",
        "transition-[border-color,box-shadow,opacity] duration-150",
        isDragging && "opacity-50 shadow-lg ring-2 ring-primary"
      )}
    >
      <CardContent task={task} />
    </div>
  );
}

export const KanbanCard = memo(KanbanCardInner, (prev, next) => {
  return (
    prev.task.id === next.task.id &&
    prev.task.title === next.task.title &&
    prev.task.status === next.task.status &&
    prev.task.identifier === next.task.identifier &&
    prev.task.assignee?.id === next.task.assignee?.id &&
    prev.task.bobView?.needsInput === next.task.bobView?.needsInput &&
    prev.task.bobView?.inReview === next.task.bobView?.inReview &&
    prev.task.bobView?.hasPr === next.task.bobView?.hasPr &&
    prev.task.bobView?.verificationStatus === next.task.bobView?.verificationStatus &&
    prev.task.labels?.length === next.task.labels?.length &&
    prev.onClick === next.onClick
  );
});

export function KanbanCardOverlay({ task }: { task: KanbanTask }) {
  return (
    <div
      className={cn(
        "cursor-grabbing rounded-md border border-primary bg-background p-3 shadow-xl",
        "ring-2 ring-primary"
      )}
    >
      <CardContent task={task} />
    </div>
  );
}

const CardContent = memo(function CardContent({ task }: { task: KanbanTask }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="font-mono text-xs text-muted-foreground">
          {task.identifier}
        </span>
      </div>

      <p className="text-sm font-medium line-clamp-2">{task.title}</p>

      <BobTaskIndicators bobView={task.bobView} compact />

      {task.labels && task.labels.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {task.labels.slice(0, 3).map((label) => (
            <span
              key={label.id}
              className="inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px]"
              style={{
                backgroundColor: `${label.color}20`,
                color: label.color,
              }}
            >
              {label.name}
            </span>
          ))}
        </div>
      )}

      <div className="flex items-center justify-between">
        {task.assignee ? (
          <div className="flex items-center gap-1">
            {task.assignee.isAgent ? (
              <div
                className={cn(
                  "flex h-5 items-center justify-center rounded-full px-1.5 text-[10px] font-medium gap-0.5",
                  task.status === "in_progress"
                    ? "bg-green-500/20 text-green-600"
                    : "bg-purple-500/20 text-purple-600"
                )}
              >
                <Bot className="h-3 w-3" />
                AI
              </div>
            ) : (
              <div className="flex h-5 w-5 items-center justify-center rounded-full bg-primary text-[10px] font-medium text-primary-foreground">
                {task.assignee.name?.charAt(0) ?? "?"}
              </div>
            )}
          </div>
        ) : (
          <div />
        )}
        {task.project && (
          <div className="flex items-center gap-1">
            <span
              className="h-2 w-2 rounded"
              style={{ backgroundColor: task.project.color ?? "#6366f1" }}
            />
            <span className="text-[10px] text-muted-foreground">
              {task.project.name}
            </span>
          </div>
        )}
      </div>
    </div>
  );
});
