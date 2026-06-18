"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useTRPC } from "~/trpc/react";

const CATEGORY_LABELS: Record<string, string> = {
  data: "DATA LAYER",
  api: "API LAYER",
  ui: "UI LAYER",
  infra: "INFRA",
  test: "TESTING",
  other: "OTHER",
};

const CATEGORIES = ["data", "api", "ui", "infra", "test", "other"] as const;

interface RequirementsChecklistProps {
  workItemId: string;
  workItemKind: string;
}

export function RequirementsChecklist({
  workItemId,
  workItemKind,
}: RequirementsChecklistProps) {
  if (workItemKind !== "epic" && workItemKind !== "issue") {
    return null;
  }

  return <RequirementsChecklistInner workItemId={workItemId} />;
}

function RequirementsChecklistInner({ workItemId }: { workItemId: string }) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  const { data: grouped } = useQuery(
    trpc.requirement.list.queryOptions(
      { workItemId },
      { staleTime: 15_000 },
    ),
  );

  const updateRequirement = useMutation(
    trpc.requirement.update.mutationOptions({
      onSuccess: () => {
        void queryClient.invalidateQueries({
          queryKey: trpc.requirement.list.queryKey({ workItemId }),
        });
      },
    }),
  );

  const createRequirement = useMutation(
    trpc.requirement.create.mutationOptions({
      onSuccess: () => {
        void queryClient.invalidateQueries({
          queryKey: trpc.requirement.list.queryKey({ workItemId }),
        });
      },
    }),
  );

  if (!grouped) return null;

  // Compute totals across all categories
  let totalCount = 0;
  let doneCount = 0;
  for (const group of Object.values(grouped)) {
    totalCount += group.total;
    doneCount += group.done;
  }

  const pct = totalCount > 0 ? Math.round((doneCount / totalCount) * 100) : 0;

  // Determine which categories exist in data, plus preserve order
  const categoryKeys = CATEGORIES.filter((c) => c in grouped);

  return (
    <div className="space-y-4">
      {/* Header with progress */}
      <div className="flex items-center gap-3">
        <h2 className="font-display text-lg font-semibold text-foreground">
          Requirements
        </h2>
        <span className="text-sm text-muted-foreground">
          {doneCount}/{totalCount}
        </span>
      </div>
      <div className="h-2 rounded-full bg-secondary">
        <div
          className="h-2 rounded-full bg-primary transition-all duration-300"
          style={{ width: `${pct}%` }}
        />
      </div>

      {/* Category groups */}
      {categoryKeys.map((category) => {
        const group = grouped[category]!;
        return (
          <CategoryGroup
            key={category}
            category={category}
            items={group.items}
            onToggle={(id, currentStatus) => {
              updateRequirement.mutate({
                id,
                status: currentStatus === "done" ? "pending" : "done",
              });
            }}
            onAdd={(description) => {
              createRequirement.mutate({
                workItemId,
                category,
                description,
              });
            }}
            isPending={updateRequirement.isPending || createRequirement.isPending}
          />
        );
      })}

      {/* Add requirement for new categories */}
      {categoryKeys.length === 0 && (
        <div className="rounded-2xl border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
          No requirements yet.
        </div>
      )}

      <AddRequirementRow
        workItemId={workItemId}
        onAdd={(description, category) => {
          createRequirement.mutate({ workItemId, category, description });
        }}
        isPending={createRequirement.isPending}
      />
    </div>
  );
}

function CategoryGroup({
  category,
  items,
  onToggle,
  onAdd,
  isPending,
}: {
  category: string;
  items: Array<{
    id: string;
    description: string;
    status: string;
    linkedTaskId: string | null;
  }>;
  onToggle: (id: string, currentStatus: string) => void;
  onAdd: (description: string) => void;
  isPending: boolean;
}) {
  const [newDesc, setNewDesc] = useState("");

  return (
    <div>
      <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {CATEGORY_LABELS[category] ?? category.toUpperCase()}
      </div>
      <div className="space-y-1">
        {items.map((item) => (
          <RequirementRow
            key={item.id}
            item={item}
            onToggle={() => onToggle(item.id, item.status)}
            disabled={isPending}
          />
        ))}
      </div>

      {/* Inline add for this category */}
      <form
        className="mt-2 flex items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          const trimmed = newDesc.trim();
          if (!trimmed) return;
          onAdd(trimmed);
          setNewDesc("");
        }}
      >
        <input
          type="text"
          value={newDesc}
          onChange={(e) => setNewDesc(e.target.value)}
          placeholder="Add requirement..."
          className="flex-1 rounded-lg border border-border bg-accent px-3 py-1.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
          disabled={isPending}
        />
        <button
          type="submit"
          disabled={isPending || !newDesc.trim()}
          className="rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition hover:bg-primary/90 disabled:opacity-50"
        >
          Add
        </button>
      </form>
    </div>
  );
}

function RequirementRow({
  item,
  onToggle,
  disabled,
}: {
  item: {
    id: string;
    description: string;
    status: string;
    linkedTaskId: string | null;
  };
  onToggle: () => void;
  disabled: boolean;
}) {
  const isDone = item.status === "done";
  const isInProgress = item.status === "in_progress";

  return (
    <div className="flex items-center gap-3 rounded-lg px-2 py-1.5 transition hover:bg-accent">
      {/* Checkbox */}
      <button
        type="button"
        onClick={onToggle}
        disabled={disabled}
        className={`flex h-5 w-5 shrink-0 items-center justify-center rounded border-2 transition ${
          isDone
            ? "border-emerald-500 bg-emerald-500 text-white"
            : "border-border bg-transparent hover:border-muted-foreground/50"
        }`}
        aria-label={isDone ? "Mark as pending" : "Mark as done"}
      >
        {isDone && (
          <svg
            width="12"
            height="12"
            viewBox="0 0 12 12"
            fill="none"
            aria-hidden="true"
          >
            <path
              d="M2.5 6L5 8.5L9.5 3.5"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        )}
      </button>

      {/* Description */}
      <span
        className={`flex-1 text-sm ${
          isDone
            ? "text-muted-foreground line-through"
            : "text-foreground"
        }`}
      >
        {item.description}
      </span>

      {/* Linked task badge */}
      {item.linkedTaskId && (
        <span className="rounded-full border border-border px-2 py-0.5 font-mono text-xs text-muted-foreground">
          {item.linkedTaskId.slice(0, 8)}
        </span>
      )}

      {/* Status badge for non-done items */}
      {!isDone && isInProgress && (
        <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-xs font-medium text-amber-500">
          in progress
        </span>
      )}
      {!isDone && !isInProgress && (
        <span className="rounded-full bg-slate-500/15 px-2 py-0.5 text-xs font-medium text-slate-400">
          pending
        </span>
      )}
    </div>
  );
}

function AddRequirementRow({
  workItemId,
  onAdd,
  isPending,
}: {
  workItemId: string;
  onAdd: (description: string, category: (typeof CATEGORIES)[number]) => void;
  isPending: boolean;
}) {
  const [desc, setDesc] = useState("");
  const [category, setCategory] = useState<(typeof CATEGORIES)[number]>("other");

  return (
    <form
      className="flex items-center gap-2 border-t border-border pt-3"
      onSubmit={(e) => {
        e.preventDefault();
        const trimmed = desc.trim();
        if (!trimmed) return;
        onAdd(trimmed, category);
        setDesc("");
      }}
    >
      <input
        type="text"
        value={desc}
        onChange={(e) => setDesc(e.target.value)}
        placeholder="New requirement..."
        className="flex-1 rounded-lg border border-border bg-accent px-3 py-1.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
        disabled={isPending}
      />
      <select
        value={category}
        onChange={(e) => setCategory(e.target.value as (typeof CATEGORIES)[number])}
        className="rounded-lg border border-border bg-accent px-2 py-1.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
        disabled={isPending}
      >
        {CATEGORIES.map((c) => (
          <option key={c} value={c}>
            {CATEGORY_LABELS[c]}
          </option>
        ))}
      </select>
      <button
        type="submit"
        disabled={isPending || !desc.trim()}
        className="rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition hover:bg-primary/90 disabled:opacity-50"
      >
        Add
      </button>
    </form>
  );
}
