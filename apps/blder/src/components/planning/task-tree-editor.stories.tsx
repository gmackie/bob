import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

import { cn } from "@bob/ui";
import { Badge } from "@bob/ui/badge";
import { Button } from "@bob/ui/button";
import { KIND_COLOR, PRIORITY_COLOR, formatLabel } from "~/lib/design/colors";

// ---------------------------------------------------------------------------
// Storybook-only presentational replica of TaskTreeEditor.
// The real component is tightly coupled to tRPC; this mock lets us render
// the visual tree with sample data and working drag-and-drop.
// ---------------------------------------------------------------------------

interface Draft {
  id: string;
  title: string;
  kind: string;
  priority: string;
  sortOrder: number;
}

function DragHandleIcon({ className }: { className?: string }) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" className={className}>
      <circle cx="5" cy="3" r="1.5" />
      <circle cx="11" cy="3" r="1.5" />
      <circle cx="5" cy="8" r="1.5" />
      <circle cx="11" cy="8" r="1.5" />
      <circle cx="5" cy="13" r="1.5" />
      <circle cx="11" cy="13" r="1.5" />
    </svg>
  );
}

function SortableItem({ draft, onDelete }: { draft: Draft; onDelete: (id: string) => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: draft.id });
  const isTask = draft.kind === "task" || draft.kind === "issue";
  const style = { transform: CSS.Transform.toString(transform), transition };

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
      <button
        type="button"
        className="flex h-11 w-11 shrink-0 cursor-grab items-center justify-center rounded text-primary/40 hover:text-primary/70 active:cursor-grabbing"
        {...attributes}
        {...listeners}
      >
        <DragHandleIcon />
      </button>
      <Badge variant={KIND_COLOR[draft.kind] ?? "slate"} className="shrink-0 text-[10px]">
        {formatLabel(draft.kind)}
      </Badge>
      <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
        {draft.title}
      </span>
      {draft.priority !== "no_priority" && (
        <Badge variant={PRIORITY_COLOR[draft.priority] ?? "slate"} className="shrink-0 text-[10px]">
          {formatLabel(draft.priority)}
        </Badge>
      )}
      <button
        type="button"
        onClick={() => onDelete(draft.id)}
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
// Interactive mock wrapper
// ---------------------------------------------------------------------------

function TaskTreeEditorMock({ initialDrafts }: { initialDrafts: Draft[] }) {
  const [drafts, setDrafts] = useState(initialDrafts);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const sorted = [...drafts].sort((a, b) => {
    const aIsEpic = a.kind === "epic" ? 0 : 1;
    const bIsEpic = b.kind === "epic" ? 0 : 1;
    if (aIsEpic !== bIsEpic) return aIsEpic - bIsEpic;
    return a.sortOrder - b.sortOrder;
  });

  const sortedIds = sorted.map((d) => d.id);

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = sortedIds.indexOf(active.id as string);
    const newIndex = sortedIds.indexOf(over.id as string);
    if (oldIndex === -1 || newIndex === -1) return;
    const reordered = arrayMove(sorted, oldIndex, newIndex).map((d, i) => ({ ...d, sortOrder: i }));
    setDrafts(reordered);
  };

  const handleDelete = (id: string) => setDrafts((prev) => prev.filter((d) => d.id !== id));

  return (
    <div className="space-y-3">
      {sorted.length === 0 ? (
        <div className="rounded-md border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
          No draft tasks yet. Add tasks below or let the planning agent create them.
        </div>
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={sortedIds} strategy={verticalListSortingStrategy}>
            <div className="space-y-2">
              {sorted.map((draft) => (
                <SortableItem key={draft.id} draft={draft} onDelete={handleDelete} />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      )}

      <div className="flex gap-2">
        <button
          type="button"
          onClick={() =>
            setDrafts((prev) => [
              ...prev,
              { id: `task-${Date.now()}`, title: "New task", kind: "task", priority: "no_priority", sortOrder: prev.length },
            ])
          }
          className="flex-1 rounded-md border border-dashed border-border px-3 py-2 text-sm text-muted-foreground transition-colors hover:border-foreground/30 hover:text-foreground"
        >
          + Add task
        </button>
        <button
          type="button"
          onClick={() =>
            setDrafts((prev) => [
              ...prev,
              { id: `epic-${Date.now()}`, title: "New epic", kind: "epic", priority: "no_priority", sortOrder: 0 },
            ])
          }
          className="flex-1 rounded-md border border-dashed border-border px-3 py-2 text-sm text-muted-foreground transition-colors hover:border-foreground/30 hover:text-foreground"
        >
          + Add epic
        </button>
      </div>

      <Button className="w-full rounded-md bg-primary text-white hover:bg-primary/90" disabled={sorted.length === 0}>
        Commit {sorted.length} task{sorted.length === 1 ? "" : "s"}
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sample data
// ---------------------------------------------------------------------------

const sampleDrafts: Draft[] = [
  { id: "epic-1", title: "Priority system for work items", kind: "epic", priority: "high", sortOrder: 0 },
  { id: "task-1", title: "Add priority field to work_items schema", kind: "task", priority: "high", sortOrder: 1 },
  { id: "task-2", title: "Update board view to sort by priority", kind: "task", priority: "medium", sortOrder: 2 },
  { id: "task-3", title: "Agent task selection: respect priority ranking", kind: "task", priority: "medium", sortOrder: 3 },
  { id: "task-4", title: "Add priority badge to work item cards", kind: "issue", priority: "low", sortOrder: 4 },
];

// ---------------------------------------------------------------------------
// Storybook meta
// ---------------------------------------------------------------------------

const meta: Meta<typeof TaskTreeEditorMock> = {
  title: "Planning/TaskTreeEditor",
  component: TaskTreeEditorMock,
  args: {
    initialDrafts: sampleDrafts,
  },
  parameters: {
    layout: "padded",
  },
  decorators: [
    (Story) => (
      <div className="mx-auto max-w-2xl py-8">
        <Story />
      </div>
    ),
  ],
};

export default meta;

type Story = StoryObj<typeof TaskTreeEditorMock>;

/** Default tree with a mix of epics, tasks, and an issue. Drag to reorder. */
export const Default: Story = {};

/** Empty state — no drafts yet. */
export const Empty: Story = {
  args: {
    initialDrafts: [],
  },
};

/** Single epic with one task. */
export const Minimal: Story = {
  args: {
    initialDrafts: [
      { id: "epic-1", title: "Ship v1 priority system", kind: "epic", priority: "high", sortOrder: 0 },
      { id: "task-1", title: "Implement database migration", kind: "task", priority: "high", sortOrder: 1 },
    ],
  },
};

/** Many tasks to test scrolling and drag performance. */
export const LargeTree: Story = {
  args: {
    initialDrafts: [
      { id: "epic-1", title: "Priority system", kind: "epic", priority: "high", sortOrder: 0 },
      ...Array.from({ length: 12 }, (_, i) => ({
        id: `task-${i + 1}`,
        title: `Task ${i + 1} — Implementation step for the priority system`,
        kind: "task" as const,
        priority: ["high", "medium", "low", "no_priority"][i % 4]!,
        sortOrder: i + 1,
      })),
    ],
  },
};
