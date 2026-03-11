"use client";

import { useState } from "react";
import { cn } from "@linear-clone/ui/lib/utils";
import { Input } from "@linear-clone/ui/components/input";
import { Avatar, AvatarFallback, AvatarImage } from "@linear-clone/ui/components/avatar";
import { StatusBadge, type TaskStatus } from "./status-badge";
import { PriorityBadge, type TaskPriority } from "./priority-badge";
import {
  Plus,
  ChevronDown,
  ChevronRight,
  Loader2,
} from "lucide-react";

interface SubTask {
  id: string;
  identifier: string;
  title: string;
  status: TaskStatus;
  priority: TaskPriority;
  assignee?: {
    id: string;
    name: string | null;
    avatarUrl: string | null;
  } | null;
}

interface SubTasksProps {
  parentId?: string;
  subTasks: SubTask[];
  isLoading?: boolean;
  onSubTaskClick?: (subTask: SubTask) => void;
  onCreateSubTask?: (title: string) => Promise<void>;
  onStatusChange?: (subTaskId: string, status: TaskStatus) => void;
}

function SubTaskItem({
  subTask,
  onClick,
  onStatusChange,
}: {
  subTask: SubTask;
  onClick?: () => void;
  onStatusChange?: (status: TaskStatus) => void;
}) {
  const isComplete = subTask.status === "done" || subTask.status === "canceled";

  return (
    <div
      className={cn(
        "group flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-muted cursor-pointer",
        isComplete && "opacity-60"
      )}
      onClick={onClick}
    >
      <button
        onClick={(e) => {
          e.stopPropagation();
          onStatusChange?.(isComplete ? "todo" : "done");
        }}
        className="flex-shrink-0"
      >
        <StatusBadge status={subTask.status} />
      </button>
      
      <span className="font-mono text-xs text-muted-foreground flex-shrink-0">
        {subTask.identifier}
      </span>
      
      <span
        className={cn(
          "flex-1 truncate text-sm",
          isComplete && "line-through"
        )}
      >
        {subTask.title}
      </span>

      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        <PriorityBadge priority={subTask.priority} />
      </div>

      {subTask.assignee && (
        <Avatar className="h-5 w-5 flex-shrink-0">
          <AvatarImage src={subTask.assignee.avatarUrl ?? ""} />
          <AvatarFallback className="text-[10px]">
            {subTask.assignee.name?.charAt(0) ?? "?"}
          </AvatarFallback>
        </Avatar>
      )}
    </div>
  );
}

export function SubTasks({
  subTasks,
  isLoading,
  onSubTaskClick,
  onCreateSubTask,
  onStatusChange,
}: SubTasksProps) {
  const [isExpanded, setIsExpanded] = useState(true);
  const [isCreating, setIsCreating] = useState(false);
  const [newSubTaskTitle, setNewSubTaskTitle] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const completedCount = subTasks.filter(
    (t) => t.status === "done" || t.status === "canceled"
  ).length;
  const totalCount = subTasks.length;
  const progress = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;

  const handleCreateSubTask = async () => {
    if (!newSubTaskTitle.trim() || !onCreateSubTask) return;
    
    setIsSubmitting(true);
    try {
      await onCreateSubTask(newSubTaskTitle.trim());
      setNewSubTaskTitle("");
      setIsCreating(false);
    } catch (error) {
      console.error("Failed to create sub-task:", error);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      handleCreateSubTask();
    } else if (e.key === "Escape") {
      setIsCreating(false);
      setNewSubTaskTitle("");
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading sub-tasks...
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className="flex items-center gap-2 text-sm font-medium hover:text-foreground"
        >
          {isExpanded ? (
            <ChevronDown className="h-4 w-4" />
          ) : (
            <ChevronRight className="h-4 w-4" />
          )}
          Sub-tasks
          {totalCount > 0 && (
            <span className="text-muted-foreground font-normal">
              ({completedCount}/{totalCount})
            </span>
          )}
        </button>

        {totalCount > 0 && (
          <div className="flex items-center gap-2">
            <div className="h-1.5 w-24 rounded-full bg-muted overflow-hidden">
              <div
                className="h-full bg-primary rounded-full transition-all"
                style={{ width: `${progress}%` }}
              />
            </div>
            <span className="text-xs text-muted-foreground">{progress}%</span>
          </div>
        )}
      </div>

      {isExpanded && (
        <div className="space-y-1 pl-2">
          {subTasks.map((subTask) => (
            <SubTaskItem
              key={subTask.id}
              subTask={subTask}
              onClick={() => onSubTaskClick?.(subTask)}
              onStatusChange={(status) => onStatusChange?.(subTask.id, status)}
            />
          ))}

          {isCreating ? (
            <div className="flex items-center gap-2 px-2 py-1.5">
              <StatusBadge status="todo" />
              <Input
                autoFocus
                value={newSubTaskTitle}
                onChange={(e) => setNewSubTaskTitle(e.target.value)}
                onKeyDown={handleKeyDown}
                onBlur={() => {
                  if (!newSubTaskTitle.trim()) {
                    setIsCreating(false);
                  }
                }}
                placeholder="Sub-task title..."
                className="h-7 text-sm flex-1"
                disabled={isSubmitting}
              />
              {isSubmitting && <Loader2 className="h-4 w-4 animate-spin" />}
            </div>
          ) : (
            <button
              onClick={() => setIsCreating(true)}
              className="flex items-center gap-2 px-2 py-1.5 text-sm text-muted-foreground hover:text-foreground hover:bg-muted rounded-md w-full"
            >
              <Plus className="h-4 w-4" />
              Add sub-task
            </button>
          )}
        </div>
      )}
    </div>
  );
}
