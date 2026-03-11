"use client";

import { memo, useCallback, useMemo } from "react";
import { useDroppable } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { cn } from "@linear-clone/ui/lib/utils";
import { StatusBadge, type TaskStatus, statusConfig } from "./status-badge";
import { KanbanCard, type KanbanTask } from "./kanban-card";

interface KanbanColumnProps {
  status: TaskStatus;
  tasks: KanbanTask[];
  onTaskClick?: (task: KanbanTask) => void;
}

function KanbanColumnInner({ status, tasks, onTaskClick }: KanbanColumnProps) {
  const config = statusConfig[status];
  const count = tasks.length;

  const { setNodeRef, isOver } = useDroppable({
    id: status,
    data: {
      type: "column",
      status,
    },
  });

  const taskIds = useMemo(() => tasks.map((t) => t.id), [tasks]);

  const handleTaskClick = useCallback(
    (task: KanbanTask) => {
      onTaskClick?.(task);
    },
    [onTaskClick]
  );

  return (
    <div
      ref={setNodeRef}
      className={cn(
        "flex h-full w-72 flex-shrink-0 flex-col rounded-lg bg-muted/30",
        isOver && "ring-2 ring-primary ring-inset"
      )}
    >
      <div className="flex items-center justify-between px-3 py-2">
        <div className="flex items-center gap-2">
          <StatusBadge status={status} />
          <span className="text-sm font-medium">{config.label}</span>
          <span className="text-xs text-muted-foreground">{count}</span>
        </div>
      </div>

      <SortableContext items={taskIds} strategy={verticalListSortingStrategy}>
        <div className="flex-1 space-y-1 overflow-y-auto px-2 pb-2">
          {tasks.map((task) => (
            <MemoizedTaskCard
              key={task.id}
              task={task}
              onTaskClick={handleTaskClick}
            />
          ))}
          {tasks.length === 0 && (
            <div className="flex h-20 items-center justify-center text-xs text-muted-foreground">
              No tasks
            </div>
          )}
        </div>
      </SortableContext>
    </div>
  );
}

const MemoizedTaskCard = memo(function MemoizedTaskCard({
  task,
  onTaskClick,
}: {
  task: KanbanTask;
  onTaskClick: (task: KanbanTask) => void;
}) {
  const handleClick = useCallback(() => {
    onTaskClick(task);
  }, [onTaskClick, task]);

  return <KanbanCard task={task} onClick={handleClick} />;
});

export const KanbanColumn = memo(KanbanColumnInner);
