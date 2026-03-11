"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { api } from "@/lib/trpc/client";
import { Button } from "@linear-clone/ui/components/button";
import { Input } from "@linear-clone/ui/components/input";
import { cn } from "@linear-clone/ui/lib/utils";
import {
  Plus,
  LayoutGrid,
  Search,
  MoreHorizontal,
  Star,
  Copy,
  Trash2,
  Globe,
  Lock,
  Filter,
} from "lucide-react";
import {
  FilterBuilder,
  createEmptyFilterGroup,
  type FilterGroup,
} from "@/components/views/filter-builder";

interface CustomView {
  id: string;
  name: string;
  description: string | null;
  icon: string | null;
  color: string | null;
  filters: Record<string, unknown>;
  shared: boolean;
  creator: {
    id: string;
    name: string | null;
    avatarUrl: string | null;
  };
  isOwner: boolean;
  createdAt: Date;
}

const STATUS_OPTIONS = [
  { value: "backlog", label: "Backlog" },
  { value: "todo", label: "Todo" },
  { value: "in_progress", label: "In Progress" },
  { value: "in_review", label: "In Review" },
  { value: "done", label: "Done" },
  { value: "canceled", label: "Canceled" },
];

const PRIORITY_OPTIONS = [
  { value: "urgent", label: "Urgent" },
  { value: "high", label: "High" },
  { value: "medium", label: "Medium" },
  { value: "low", label: "Low" },
  { value: "no_priority", label: "No Priority" },
];

const FILTER_FIELDS = [
  { key: "status", label: "Status", type: "select" as const, options: STATUS_OPTIONS },
  { key: "priority", label: "Priority", type: "select" as const, options: PRIORITY_OPTIONS },
  { key: "assignee", label: "Assignee", type: "user" as const },
  { key: "title", label: "Title", type: "text" as const },
  { key: "dueDate", label: "Due Date", type: "date" as const },
];

function ViewCard({
  view,
  onClick,
  onDuplicate,
  onDelete,
  onToggleFavorite,
  isFavorite,
}: {
  view: CustomView;
  onClick: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onToggleFavorite: () => void;
  isFavorite: boolean;
}) {
  const [showMenu, setShowMenu] = useState(false);
  const filterCount = Object.keys(view.filters).length;

  return (
    <div
      className="group relative rounded-lg border border-border bg-card p-4 transition-colors hover:bg-muted/50"
    >
      <button
        type="button"
        onClick={onClick}
        className="w-full text-left"
      >
        <div className="flex items-start gap-3">
          <div
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg"
            style={{ backgroundColor: `${view.color ?? "#6366f1"}20` }}
          >
            <LayoutGrid
              className="h-5 w-5"
              style={{ color: view.color ?? "#6366f1" }}
            />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h3 className="font-medium truncate">{view.name}</h3>
              {view.shared ? (
                <Globe className="h-3.5 w-3.5 text-muted-foreground" />
              ) : (
                <Lock className="h-3.5 w-3.5 text-muted-foreground" />
              )}
            </div>
            {view.description && (
              <p className="mt-0.5 text-sm text-muted-foreground line-clamp-2">
                {view.description}
              </p>
            )}
            <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
              {filterCount > 0 && (
                <span className="flex items-center gap-1">
                  <Filter className="h-3 w-3" />
                  {filterCount} filter{filterCount !== 1 ? "s" : ""}
                </span>
              )}
              <span>by {view.creator.name ?? "Unknown"}</span>
            </div>
          </div>
        </div>
      </button>

      <div className="absolute right-2 top-2 flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={(e) => {
            e.stopPropagation();
            onToggleFavorite();
          }}
        >
          <Star
            className={cn(
              "h-3.5 w-3.5",
              isFavorite ? "fill-yellow-400 text-yellow-400" : ""
            )}
          />
        </Button>
        <div className="relative">
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={(e) => {
              e.stopPropagation();
              setShowMenu(!showMenu);
            }}
          >
            <MoreHorizontal className="h-3.5 w-3.5" />
          </Button>
          {showMenu && (
            <div className="absolute right-0 top-full z-50 mt-1 w-36 rounded-md border border-border bg-popover p-1 shadow-lg">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onDuplicate();
                  setShowMenu(false);
                }}
                className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-muted"
              >
                <Copy className="h-3.5 w-3.5" />
                Duplicate
              </button>
              {view.isOwner && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDelete();
                    setShowMenu(false);
                  }}
                  className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm text-red-500 hover:bg-muted"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Delete
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function CreateViewModal({
  onClose,
  onCreate,
}: {
  workspaceId?: string;
  onClose: () => void;
  onCreate: (data: {
    name: string;
    description?: string;
    color?: string;
    filters: Record<string, unknown>;
    shared: boolean;
  }) => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [color, setColor] = useState("#6366f1");
  const [shared, setShared] = useState(false);
  const [filters, setFilters] = useState<FilterGroup>(createEmptyFilterGroup());

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    const filterObj: Record<string, unknown> = {};
    filters.conditions.forEach((c) => {
      filterObj[c.field] = { operator: c.operator, value: c.value };
    });

    onCreate({
      name: name.trim(),
      description: description.trim() || undefined,
      color,
      filters: filterObj,
      shared,
    });
  };

  const colors = [
    "#ef4444", "#f97316", "#eab308", "#22c55e", "#14b8a6",
    "#3b82f6", "#6366f1", "#8b5cf6", "#ec4899", "#6b7280",
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-lg rounded-lg border border-border bg-background p-6 shadow-lg">
        <h2 className="text-lg font-semibold">Create View</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Save filters and display settings as a reusable view.
        </p>

        <form onSubmit={handleSubmit} className="mt-4 space-y-4">
          <div>
            <label className="text-sm font-medium">Name</label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="My View"
              className="mt-1"
              autoFocus
            />
          </div>

          <div>
            <label className="text-sm font-medium">Description</label>
            <Input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional description"
              className="mt-1"
            />
          </div>

          <div>
            <label className="text-sm font-medium">Color</label>
            <div className="mt-2 flex gap-2">
              {colors.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setColor(c)}
                  className={cn(
                    "h-6 w-6 rounded-full transition-transform",
                    color === c && "ring-2 ring-primary ring-offset-2"
                  )}
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>
          </div>

          <div>
            <label className="text-sm font-medium">Filters</label>
            <div className="mt-2 rounded-md border border-border p-3">
              <FilterBuilder
                value={filters}
                onChange={setFilters}
                availableFields={FILTER_FIELDS}
              />
            </div>
          </div>

          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="shared"
              checked={shared}
              onChange={(e) => setShared(e.target.checked)}
              className="h-4 w-4 rounded border-border"
            />
            <label htmlFor="shared" className="text-sm">
              Share with team
            </label>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={!name.trim()}>
              Create View
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function ViewsPage() {
  const params = useParams();
  const router = useRouter();
  const workspaceSlug = params.workspaceSlug as string;

  const [searchQuery, setSearchQuery] = useState("");
  const [showCreateModal, setShowCreateModal] = useState(false);

  const { data: workspace } = api.workspace.get.useQuery(
    { slug: workspaceSlug },
    { enabled: !!workspaceSlug }
  );

  const { data: views, isLoading } = api.view.list.useQuery(
    { workspaceId: workspace?.id ?? "", includeShared: true },
    { enabled: !!workspace?.id }
  );

  const { data: favorites } = api.favorite.list.useQuery(
    { workspaceId: workspace?.id },
    { enabled: !!workspace?.id }
  );

  const utils = api.useUtils();

  const createViewMutation = api.view.create.useMutation({
    onSuccess: () => {
      utils.view.list.invalidate();
      setShowCreateModal(false);
    },
  });

  const deleteViewMutation = api.view.delete.useMutation({
    onSuccess: () => {
      utils.view.list.invalidate();
    },
  });

  const duplicateViewMutation = api.view.duplicate.useMutation({
    onSuccess: () => {
      utils.view.list.invalidate();
    },
  });

  const addFavoriteMutation = api.favorite.add.useMutation({
    onSuccess: () => {
      utils.favorite.list.invalidate();
    },
  });

  const removeFavoriteMutation = api.favorite.removeByItem.useMutation({
    onSuccess: () => {
      utils.favorite.list.invalidate();
    },
  });

  const handleCreateView = (data: {
    name: string;
    description?: string;
    color?: string;
    filters: Record<string, unknown>;
    shared: boolean;
  }) => {
    if (!workspace?.id) return;
    createViewMutation.mutate({
      workspaceId: workspace.id,
      ...data,
    });
  };

  const handleViewClick = (viewId: string) => {
    router.push(`/dashboard/${workspaceSlug}/views/${viewId}`);
  };

  const handleDuplicate = (viewId: string) => {
    duplicateViewMutation.mutate({ id: viewId });
  };

  const handleDelete = (viewId: string) => {
    if (confirm("Are you sure you want to delete this view?")) {
      deleteViewMutation.mutate({ id: viewId });
    }
  };

  const handleToggleFavorite = (viewId: string) => {
    const favorite = favorites?.find((f) => f.customViewId === viewId);
    if (favorite) {
      removeFavoriteMutation.mutate({ customViewId: viewId });
    } else {
      addFavoriteMutation.mutate({ customViewId: viewId });
    }
  };

  const isFavorite = (viewId: string) => {
    return favorites?.some((f) => f.customViewId === viewId) ?? false;
  };

  const filteredViews = views?.filter((v) =>
    v.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const myViews = filteredViews?.filter((v) => v.isOwner) ?? [];
  const sharedViews = filteredViews?.filter((v) => !v.isOwner) ?? [];

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-border px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10">
              <LayoutGrid className="h-5 w-5 text-primary" />
            </div>
            <div>
              <h1 className="text-xl font-semibold">Views</h1>
              <p className="text-sm text-muted-foreground">
                Save and share filtered views of your tasks
              </p>
            </div>
          </div>
          <Button size="sm" onClick={() => setShowCreateModal(true)}>
            <Plus className="mr-1 h-4 w-4" />
            New View
          </Button>
        </div>

        <div className="relative mt-4 max-w-sm">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search views..."
            className="pl-9"
          />
        </div>
      </div>

      <div className="flex-1 overflow-auto p-6">
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
          </div>
        ) : !views || views.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
              <LayoutGrid className="h-6 w-6 text-muted-foreground" />
            </div>
            <h3 className="mt-4 font-medium">No views yet</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Create your first view to save filters and display settings.
            </p>
            <Button size="sm" className="mt-4" onClick={() => setShowCreateModal(true)}>
              <Plus className="mr-1 h-4 w-4" />
              Create View
            </Button>
          </div>
        ) : (
          <div className="space-y-8">
            {myViews.length > 0 && (
              <div>
                <h2 className="mb-4 text-sm font-medium text-muted-foreground">My Views</h2>
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {myViews.map((view) => (
                    <ViewCard
                      key={view.id}
                      view={view as CustomView}
                      onClick={() => handleViewClick(view.id)}
                      onDuplicate={() => handleDuplicate(view.id)}
                      onDelete={() => handleDelete(view.id)}
                      onToggleFavorite={() => handleToggleFavorite(view.id)}
                      isFavorite={isFavorite(view.id)}
                    />
                  ))}
                </div>
              </div>
            )}

            {sharedViews.length > 0 && (
              <div>
                <h2 className="mb-4 text-sm font-medium text-muted-foreground">Shared Views</h2>
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {sharedViews.map((view) => (
                    <ViewCard
                      key={view.id}
                      view={view as CustomView}
                      onClick={() => handleViewClick(view.id)}
                      onDuplicate={() => handleDuplicate(view.id)}
                      onDelete={() => handleDelete(view.id)}
                      onToggleFavorite={() => handleToggleFavorite(view.id)}
                      isFavorite={isFavorite(view.id)}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {showCreateModal && workspace && (
        <CreateViewModal
          workspaceId={workspace.id}
          onClose={() => setShowCreateModal(false)}
          onCreate={handleCreateView}
        />
      )}
    </div>
  );
}
