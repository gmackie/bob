"use client";

import { useCallback, useState } from "react";
import {
  DndContext,
  closestCenter,
  type DragEndEvent,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { cn } from "@bob/ui";
import { Badge } from "@bob/ui/badge";
import { Button } from "@bob/ui/button";
import { toast } from "@bob/ui/toast";

import { KIND_COLOR, PRIORITY_COLOR, formatLabel } from "~/lib/design/colors";
import { useTRPC } from "~/trpc/react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface TaskTreeEditorProps {
  sessionId: string;
  workspaceId: string;
  projectId: string;
  onCommit?: (result: { committed: number }) => void;
  className?: string;
}

interface Draft {
  id: string;
  title: string;
  kind: string;
  priority: string;
  sortOrder: number;
  status: string;
  description: string | null;
}

// ---------------------------------------------------------------------------
// Drag handle icon — 3x2 dot grid
// ---------------------------------------------------------------------------

function DragHandleIcon({ className }: { className?: string }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="currentColor"
      className={className}
    >
      <circle cx="5" cy="3" r="1.5" />
      <circle cx="11" cy="3" r="1.5" />
      <circle cx="5" cy="8" r="1.5" />
      <circle cx="11" cy="8" r="1.5" />
      <circle cx="5" cy="13" r="1.5" />
      <circle cx="11" cy="13" r="1.5" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Sortable item
// ---------------------------------------------------------------------------

interface SortableItemProps {
  draft: Draft;
  onDelete: (id: string) => void;
  onUpdateTitle: (id: string, title: string) => void;
  isDeleting: boolean;
}

function SortableItem({
  draft,
  onDelete,
  onUpdateTitle,
  isDeleting,
}: SortableItemProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: draft.id });

  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState(draft.title);

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const isTask = draft.kind === "task" || draft.kind === "issue";

  const handleStartEdit = useCallback(() => {
    setEditValue(draft.title);
    setEditing(true);
  }, [draft.title]);

  const handleSaveEdit = useCallback(() => {
    const trimmed = editValue.trim();
    if (trimmed && trimmed !== draft.title) {
      onUpdateTitle(draft.id, trimmed);
    }
    setEditing(false);
  }, [editValue, draft.title, draft.id, onUpdateTitle]);

  const handleCancelEdit = useCallback(() => {
    setEditValue(draft.title);
    setEditing(false);
  }, [draft.title]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter") {
        e.preventDefault();
        handleSaveEdit();
      } else if (e.key === "Escape") {
        e.preventDefault();
        handleCancelEdit();
      }
    },
    [handleSaveEdit, handleCancelEdit],
  );

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        "group flex items-center gap-2 rounded-md border border-border p-3",
        isTask && "ml-6",
        isDragging && "z-50 opacity-80 shadow-lg",
      )}
    >
      {/* Drag handle — 44px touch target */}
      <button
        type="button"
        className="flex h-11 w-11 shrink-0 cursor-grab items-center justify-center rounded text-primary/40 hover:text-primary/70 active:cursor-grabbing"
        {...attributes}
        {...listeners}
      >
        <DragHandleIcon />
      </button>

      {/* Kind badge */}
      <Badge
        variant={KIND_COLOR[draft.kind] ?? "slate"}
        className="shrink-0 text-[10px]"
      >
        {formatLabel(draft.kind)}
      </Badge>

      {/* Title — click to edit inline */}
      {editing ? (
        <input
          autoFocus
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          onBlur={handleSaveEdit}
          onKeyDown={handleKeyDown}
          className="min-w-0 flex-1 rounded border border-primary/30 bg-transparent px-1.5 py-0.5 text-sm font-medium text-foreground outline-none focus:border-primary"
        />
      ) : (
        <button
          type="button"
          onClick={handleStartEdit}
          className="min-w-0 flex-1 truncate text-left text-sm font-medium text-foreground hover:text-primary"
        >
          {draft.title}
        </button>
      )}

      {/* Priority badge */}
      {draft.priority !== "no_priority" && (
        <Badge
          variant={PRIORITY_COLOR[draft.priority] ?? "slate"}
          className="shrink-0 text-[10px]"
        >
          {formatLabel(draft.priority)}
        </Badge>
      )}

      {/* Delete button — appears on hover */}
      <button
        type="button"
        onClick={() => onDelete(draft.id)}
        disabled={isDeleting}
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-foreground group-hover:opacity-100"
        title="Remove draft"
      >
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M2 2l8 8M10 2l-8 8" />
        </svg>
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// TaskTreeEditor
// ---------------------------------------------------------------------------

export function TaskTreeEditor({
  sessionId,
  workspaceId,
  projectId,
  onCommit,
  className,
}: TaskTreeEditorProps) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  // ---- Data fetching (5s refetch) ----
  const { data, isLoading } = useQuery({
    ...trpc.planSession.get.queryOptions({ sessionId }),
    refetchInterval: 5000,
  });

  // ---- Mutations ----
  const invalidate = useCallback(() => {
    void queryClient.invalidateQueries({
      queryKey: trpc.planSession.get.queryKey({ sessionId }),
    });
  }, [queryClient, trpc, sessionId]);

  const createDraft = useMutation(
    trpc.planSession.createDraft.mutationOptions({
      onSuccess: invalidate,
      onError: (err) => toast(err.message),
    }),
  );

  const updateDraft = useMutation(
    trpc.planSession.updateDraft.mutationOptions({
      onSuccess: invalidate,
      onError: (err) => toast(err.message),
    }),
  );

  const removeDraft = useMutation(
    trpc.planSession.removeDraft.mutationOptions({
      onSuccess: invalidate,
      onError: (err) => toast(err.message),
    }),
  );

  const commitPlan = useMutation(
    trpc.planSession.commitPlan.mutationOptions({
      onSuccess: (result) => {
        if (result.committed === 0) {
          toast("No tasks were committed");
          return;
        }
        toast(
          `Committed ${result.committed} task${result.committed === 1 ? "" : "s"}`,
        );
        invalidate();
        onCommit?.(result);
      },
      onError: (err) => toast(err.message),
    }),
  );

  // ---- Pointer sensor with activation distance to avoid accidental drags ----
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  // ---- Derived data ----
  const drafts = (data?.drafts ?? []).filter(
    (d) => d.status === "draft",
  ) as Draft[];

  // Sort: epics first, then tasks, preserve sortOrder within each group
  const sorted = [...drafts].sort((a, b) => {
    const aIsEpic = a.kind === "epic" ? 0 : 1;
    const bIsEpic = b.kind === "epic" ? 0 : 1;
    if (aIsEpic !== bIsEpic) return aIsEpic - bIsEpic;
    return a.sortOrder - b.sortOrder;
  });

  const sortedIds = sorted.map((d) => d.id);

  // ---- Handlers ----
  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over || active.id === over.id) return;

      const oldIndex = sortedIds.indexOf(active.id as string);
      const newIndex = sortedIds.indexOf(over.id as string);
      if (oldIndex === -1 || newIndex === -1) return;

      const reordered = arrayMove(sorted, oldIndex, newIndex);

      // Persist new sort orders
      reordered.forEach((draft, index) => {
        if (draft.sortOrder !== index) {
          updateDraft.mutate({ id: draft.id, sortOrder: index });
        }
      });
    },
    [sortedIds, sorted, updateDraft],
  );

  const handleAddTask = useCallback(() => {
    createDraft.mutate({
      sessionId,
      workspaceId,
      projectId,
      title: "New task",
      kind: "task",
      sortOrder: drafts.length,
    });
  }, [createDraft, sessionId, workspaceId, projectId, drafts.length]);

  const handleAddEpic = useCallback(() => {
    createDraft.mutate({
      sessionId,
      workspaceId,
      projectId,
      title: "New epic",
      kind: "epic",
      sortOrder: 0,
    });
  }, [createDraft, sessionId, workspaceId, projectId]);

  const handleDelete = useCallback(
    (id: string) => {
      removeDraft.mutate({ id });
    },
    [removeDraft],
  );

  const handleUpdateTitle = useCallback(
    (id: string, title: string) => {
      updateDraft.mutate({ id, title });
    },
    [updateDraft],
  );

  // ---- Render ----
  if (isLoading) {
    return (
      <div className={cn("px-4 py-8 text-center text-sm text-muted-foreground", className)}>
        Loading task tree...
      </div>
    );
  }

  return (
    <div className={cn("space-y-3", className)}>
      {/* Task list */}
      {sorted.length === 0 ? (
        <div className="rounded-md border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
          No draft tasks yet. Add tasks below or let the planning agent create
          them.
        </div>
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <SortableContext
            items={sortedIds}
            strategy={verticalListSortingStrategy}
          >
            <div className="space-y-2">
              {sorted.map((draft) => (
                <SortableItem
                  key={draft.id}
                  draft={draft}
                  onDelete={handleDelete}
                  onUpdateTitle={handleUpdateTitle}
                  isDeleting={removeDraft.isPending}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      )}

      {/* Add buttons */}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={handleAddTask}
          disabled={createDraft.isPending}
          className="flex-1 rounded-md border border-dashed border-border px-3 py-2 text-sm text-muted-foreground transition-colors hover:border-foreground/30 hover:text-foreground"
        >
          + Add task
        </button>
        <button
          type="button"
          onClick={handleAddEpic}
          disabled={createDraft.isPending}
          className="flex-1 rounded-md border border-dashed border-border px-3 py-2 text-sm text-muted-foreground transition-colors hover:border-foreground/30 hover:text-foreground"
        >
          + Add epic
        </button>
      </div>

      {/* Commit button */}
      <Button
        className="w-full rounded-md bg-primary text-white hover:bg-primary/90"
        onClick={() => commitPlan.mutate({ sessionId })}
        disabled={commitPlan.isPending || sorted.length === 0}
      >
        {commitPlan.isPending
          ? "Committing..."
          : `Commit ${sorted.length} task${sorted.length === 1 ? "" : "s"}`}
      </Button>
    </div>
  );
}
