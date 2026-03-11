"use client";

import { useState, useCallback } from "react";
import { TaskRow } from "./task-row";
import type { TaskStatus } from "./status-badge";
import type { TaskPriority } from "./priority-badge";
import { BulkActionsBar } from "./bulk-actions-bar";
import { cn } from "@linear-clone/ui/lib/utils";
import { sortTasksForBobAttention, type BobTaskProjection } from "./bob-task-indicators";

interface Task {
  id: string;
  identifier: string;
  title: string;
  status: TaskStatus;
  priority: TaskPriority;
  funnelArtifactType?: string | null;
  funnelStage?: string | null;
  updatedAt?: Date;
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
  createdAt: Date;
  bobView?: BobTaskProjection | null;
}

interface TaskListProps {
  tasks: Task[];
  onTaskClick?: (task: Task) => void;
  selectedTaskId?: string | null;
  loading?: boolean;
  emptyMessage?: string;
  actions?: (task: Task) => React.ReactNode;
  showStatusLabel?: boolean;
  showUpdatedAt?: boolean;
  showUpdatedBy?: boolean;
  enableSelection?: boolean;
  onBulkStatusChange?: (taskIds: string[], status: TaskStatus) => void;
  onBulkPriorityChange?: (taskIds: string[], priority: TaskPriority) => void;
  onBulkArchive?: (taskIds: string[]) => void;
  onBulkDelete?: (taskIds: string[]) => void;
}

export function TaskList({
  tasks,
  onTaskClick,
  selectedTaskId,
  loading,
  emptyMessage = "No tasks found",
  actions,
  showStatusLabel = false,
  showUpdatedAt = false,
  showUpdatedBy = false,
  enableSelection = false,
  onBulkStatusChange,
  onBulkPriorityChange,
  onBulkArchive,
  onBulkDelete,
}: TaskListProps) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const orderedTasks = sortTasksForBobAttention(tasks);

  const toggleSelection = useCallback((taskId: string, e: React.MouseEvent) => {
    if (!enableSelection) return;
    
    e.stopPropagation();
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(taskId)) {
        next.delete(taskId);
      } else {
        next.add(taskId);
      }
      return next;
    });
  }, [enableSelection]);

  const toggleSelectAll = useCallback(() => {
    if (selectedIds.size === orderedTasks.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(orderedTasks.map((t) => t.id)));
    }
  }, [orderedTasks, selectedIds.size]);

  const clearSelection = useCallback(() => {
    setSelectedIds(new Set());
  }, []);

  const handleBulkStatusChange = (status: TaskStatus) => {
    onBulkStatusChange?.(Array.from(selectedIds), status);
    clearSelection();
  };

  const handleBulkPriorityChange = (priority: TaskPriority) => {
    onBulkPriorityChange?.(Array.from(selectedIds), priority);
    clearSelection();
  };

  const handleBulkArchive = () => {
    onBulkArchive?.(Array.from(selectedIds));
    clearSelection();
  };

  const handleBulkDelete = () => {
    if (confirm(`Delete ${selectedIds.size} task${selectedIds.size !== 1 ? "s" : ""}?`)) {
      onBulkDelete?.(Array.from(selectedIds));
      clearSelection();
    }
  };

  if (loading) {
    return (
      <div className="divide-y divide-border">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="flex items-center gap-3 px-4 py-3">
            <div className="h-4 w-4 rounded bg-muted animate-pulse" />
            <div className="h-4 w-16 rounded bg-muted animate-pulse" />
            <div className="h-4 w-8 rounded bg-muted animate-pulse" />
            <div className="h-4 flex-1 rounded bg-muted animate-pulse" />
            <div className="h-6 w-6 rounded-full bg-muted animate-pulse" />
          </div>
        ))}
      </div>
    );
  }

  if (tasks.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <svg
          className="h-12 w-12 text-muted-foreground/50"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.5}
            d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"
          />
        </svg>
        <h3 className="mt-4 text-sm font-medium text-muted-foreground">{emptyMessage}</h3>
        <p className="mt-1 text-xs text-muted-foreground/75">
          Create a new task to get started
        </p>
      </div>
    );
  }

  return (
    <div className="relative">
      {enableSelection && tasks.length > 0 && (
        <div className="flex items-center gap-2 border-b border-border px-4 py-2">
          <input
            type="checkbox"
            checked={selectedIds.size === tasks.length && tasks.length > 0}
            onChange={toggleSelectAll}
            className="h-4 w-4 rounded border-border"
          />
          <span className="text-xs text-muted-foreground">
            {selectedIds.size > 0
              ? `${selectedIds.size} of ${tasks.length} selected`
              : "Select all"}
          </span>
        </div>
      )}

      <div className="divide-y divide-border border-t border-border">
        {orderedTasks.map((task) => (
          <div
            key={task.id}
            className={cn(
              "flex items-center",
              enableSelection && selectedIds.has(task.id) && "bg-primary/5"
            )}
          >
            {enableSelection && (
              <div className="flex-shrink-0 pl-4">
                <input
                  type="checkbox"
                  checked={selectedIds.has(task.id)}
                  onChange={(e) => toggleSelection(task.id, e as unknown as React.MouseEvent)}
                  onClick={(e) => e.stopPropagation()}
                  className="h-4 w-4 rounded border-border"
                />
              </div>
            )}
            <div className="flex-1">
              <TaskRow
                task={task}
                onClick={() => onTaskClick?.(task)}
                selected={selectedTaskId === task.id}
                actions={actions?.(task)}
                showStatusLabel={showStatusLabel}
                showUpdatedAt={showUpdatedAt}
                showUpdatedBy={showUpdatedBy}
              />
            </div>
          </div>
        ))}
      </div>

      {enableSelection && (
        <BulkActionsBar
          selectedCount={selectedIds.size}
          onClearSelection={clearSelection}
          onStatusChange={onBulkStatusChange ? handleBulkStatusChange : undefined}
          onPriorityChange={onBulkPriorityChange ? handleBulkPriorityChange : undefined}
          onArchive={onBulkArchive ? handleBulkArchive : undefined}
          onDelete={onBulkDelete ? handleBulkDelete : undefined}
        />
      )}
    </div>
  );
}
