"use client";

import { useMemo, useState, useCallback } from "react";
import {
  DndContext,
  DragOverlay,
  closestCorners,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragStartEvent,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  sortableKeyboardCoordinates,
} from "@dnd-kit/sortable";
import { KanbanColumn } from "./kanban-column";
import { KanbanCardOverlay, type KanbanTask } from "./kanban-card";
import type { TaskStatus } from "./status-badge";
import { generateRankBetween, sortByRank } from "@/lib/lexorank";
import { sortTasksForBobAttention } from "./bob-task-indicators";

interface Task extends KanbanTask {
  kanbanRank?: string | null;
}

interface KanbanBoardProps {
  tasks: Task[];
  loading?: boolean;
  onTaskClick?: (task: Task) => void;
  onStatusChange?: (taskId: string, newStatus: TaskStatus) => void;
  onReorder?: (taskId: string, newStatus: TaskStatus, newRank: string) => void;
  showBacklog?: boolean;
  showClosed?: boolean;
}

const ACTIVE_STATUSES: TaskStatus[] = ["todo", "in_progress", "in_review"];

export function KanbanBoard({
  tasks,
  loading = false,
  onTaskClick,
  onStatusChange,
  onReorder,
  showBacklog = false,
  showClosed = false,
}: KanbanBoardProps) {
  const [activeId, setActiveId] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const visibleStatuses = useMemo(() => {
    const statuses: TaskStatus[] = [...ACTIVE_STATUSES];
    if (showBacklog) {
      statuses.unshift("backlog");
    }
    if (showClosed) {
      statuses.push("done", "canceled");
    }
    return statuses;
  }, [showBacklog, showClosed]);

  const tasksByStatus = useMemo(() => {
    const grouped: Record<TaskStatus, Task[]> = {
      backlog: [],
      todo: [],
      in_progress: [],
      in_review: [],
      done: [],
      canceled: [],
    };

    tasks.forEach((task) => {
      if (grouped[task.status]) {
        grouped[task.status].push(task);
      }
    });

    Object.keys(grouped).forEach((status) => {
      grouped[status as TaskStatus] = sortTasksForBobAttention(
        sortByRank(grouped[status as TaskStatus])
      );
    });

    return grouped;
  }, [tasks]);

  const activeTask = useMemo(() => {
    if (!activeId) return null;
    return tasks.find((t) => t.id === activeId) ?? null;
  }, [activeId, tasks]);

  const handleDragStart = useCallback((event: DragStartEvent) => {
    setActiveId(event.active.id as string);
  }, []);

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      setActiveId(null);

      if (!over) return;

      const activeTaskId = active.id as string;
      const activeTask = tasks.find((t) => t.id === activeTaskId);
      if (!activeTask) return;

      const overId = over.id as string;
      const isOverColumn = visibleStatuses.includes(overId as TaskStatus);

      let targetStatus: TaskStatus;
      let targetIndex: number;

      if (isOverColumn) {
        targetStatus = overId as TaskStatus;
        targetIndex = tasksByStatus[targetStatus].length;
      } else {
        const overTask = tasks.find((t) => t.id === overId);
        if (!overTask) return;
        targetStatus = overTask.status;
        targetIndex = tasksByStatus[targetStatus].findIndex((t) => t.id === overId);
      }

      const statusChanged = activeTask.status !== targetStatus;
      const columnTasks = tasksByStatus[targetStatus].filter((t) => t.id !== activeTaskId);

      const beforeTask = targetIndex > 0 ? columnTasks[targetIndex - 1] : null;
      const afterTask = targetIndex < columnTasks.length ? columnTasks[targetIndex] : null;

      const newRank = generateRankBetween(
        beforeTask?.kanbanRank ?? null,
        afterTask?.kanbanRank ?? null
      );

      if (onReorder) {
        onReorder(activeTaskId, targetStatus, newRank);
      } else if (statusChanged && onStatusChange) {
        onStatusChange(activeTaskId, targetStatus);
      }
    },
    [tasks, tasksByStatus, visibleStatuses, onReorder, onStatusChange]
  );

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      <div className="flex h-full gap-3 overflow-x-auto p-4">
        {visibleStatuses.map((status) => (
          <KanbanColumn
            key={status}
            status={status}
            tasks={tasksByStatus[status]}
            onTaskClick={onTaskClick}
          />
        ))}
      </div>
      <DragOverlay>
        {activeTask ? <KanbanCardOverlay task={activeTask} /> : null}
      </DragOverlay>
    </DndContext>
  );
}
