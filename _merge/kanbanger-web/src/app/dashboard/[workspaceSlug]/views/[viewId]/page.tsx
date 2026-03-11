"use client";

import { useState, useMemo } from "react";
import { useParams, useRouter } from "next/navigation";
import { api } from "@/lib/trpc/client";
import { Button } from "@linear-clone/ui/components/button";
import { TaskList } from "@/components/tasks/task-list";
import { TaskDetail } from "@/components/tasks/task-detail";
import { useIssueBobContext } from "@/components/tasks/use-issue-bob-context";
import type { TaskStatus } from "@/components/tasks/status-badge";
import type { TaskPriority } from "@/components/tasks/priority-badge";
import {
  ArrowLeft,
  LayoutGrid,
  Settings,
  Star,
  Globe,
  Lock,
} from "lucide-react";
import { cn } from "@linear-clone/ui/lib/utils";

export default function ViewDetailPage() {
  const params = useParams();
  const router = useRouter();
  const workspaceSlug = params.workspaceSlug as string;
  const viewId = params.viewId as string;

  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);

  const { data: workspace } = api.workspace.get.useQuery(
    { slug: workspaceSlug },
    { enabled: !!workspaceSlug }
  );

  const { data: view, isLoading: viewLoading } = api.view.get.useQuery(
    { id: viewId },
    { enabled: !!viewId }
  );

  const { data: allTasks, isLoading: tasksLoading } = api.issue.listAll.useQuery(
    { workspaceId: workspace?.id ?? "", sort: { sortBy: "updatedAt", sortDirection: "desc" } },
    { enabled: !!workspace?.id }
  );

  const { data: selectedTask } = api.issue.get.useQuery(
    { id: selectedTaskId ?? "" },
    { enabled: !!selectedTaskId }
  );
  const { bobRunHistory, childArtifactGroups } = useIssueBobContext(
    selectedTaskId,
    selectedTask?.subIssuesCount ?? 0
  );

  const { data: favorites } = api.favorite.list.useQuery(
    { workspaceId: workspace?.id },
    { enabled: !!workspace?.id }
  );

  const utils = api.useUtils();

  const updateTaskMutation = api.issue.update.useMutation({
    onSuccess: () => {
      utils.issue.list.invalidate();
      utils.issue.get.invalidate();
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

  const isFavorite = favorites?.some((f) => f.customViewId === viewId) ?? false;

  const handleToggleFavorite = () => {
    if (isFavorite) {
      removeFavoriteMutation.mutate({ customViewId: viewId });
    } else {
      addFavoriteMutation.mutate({ customViewId: viewId });
    }
  };

  const handleStatusChange = async (status: TaskStatus) => {
    if (!selectedTaskId) return;
    await updateTaskMutation.mutateAsync({ id: selectedTaskId, status });
  };

  const handlePriorityChange = async (priority: TaskPriority) => {
    if (!selectedTaskId) return;
    await updateTaskMutation.mutateAsync({ id: selectedTaskId, priority });
  };

  const filteredTasks = useMemo(() => {
    if (!allTasks || !view?.filters) return allTasks ?? [];

    const filters = view.filters as Record<string, { operator: string; value: string }>;

    return allTasks.filter((task) => {
      for (const [field, condition] of Object.entries(filters)) {
        if (!condition || !condition.operator) continue;

        const taskValue = task[field as keyof typeof task];
        const { operator, value } = condition;

        switch (operator) {
          case "is":
            if (taskValue !== value) return false;
            break;
          case "is_not":
            if (taskValue === value) return false;
            break;
          case "contains":
            if (typeof taskValue === "string" && !taskValue.toLowerCase().includes(value.toLowerCase())) {
              return false;
            }
            break;
          case "not_contains":
            if (typeof taskValue === "string" && taskValue.toLowerCase().includes(value.toLowerCase())) {
              return false;
            }
            break;
          case "is_empty":
            if (taskValue !== null && taskValue !== undefined && taskValue !== "") return false;
            break;
          case "is_not_empty":
            if (taskValue === null || taskValue === undefined || taskValue === "") return false;
            break;
        }
      }
      return true;
    });
  }, [allTasks, view?.filters]);

  const mappedTasks = filteredTasks.map((task) => ({
    id: task.id,
    identifier: task.identifier,
    title: task.title,
    status: task.status as TaskStatus,
    priority: task.priority as TaskPriority,
    assignee: task.assignee,
    labels: task.labels,
    project: task.project,
    dueDate: task.dueDate,
    createdAt: task.createdAt,
    bobView: task.bobView,
  }));

  if (viewLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  if (!view) {
    return (
      <div className="flex h-full flex-col items-center justify-center">
        <h1 className="text-xl font-semibold">View not found</h1>
        <p className="mt-2 text-muted-foreground">
          The view you&apos;re looking for doesn&apos;t exist.
        </p>
        <Button
          variant="link"
          onClick={() => router.push(`/dashboard/${workspaceSlug}/views`)}
        >
          Go back to views
        </Button>
      </div>
    );
  }

  const filterCount = Object.keys(view.filters as Record<string, unknown>).length;

  return (
    <div className="flex h-full">
      <div className="flex flex-1 flex-col overflow-hidden">
        <div className="border-b border-border px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={() => router.push(`/dashboard/${workspaceSlug}/views`)}
              >
                <ArrowLeft className="h-4 w-4" />
              </Button>
              <div
                className="flex h-9 w-9 items-center justify-center rounded-lg"
                style={{ backgroundColor: `${view.color ?? "#6366f1"}20` }}
              >
                <LayoutGrid
                  className="h-5 w-5"
                  style={{ color: view.color ?? "#6366f1" }}
                />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h1 className="text-xl font-semibold">{view.name}</h1>
                  {view.shared ? (
                    <Globe className="h-4 w-4 text-muted-foreground" />
                  ) : (
                    <Lock className="h-4 w-4 text-muted-foreground" />
                  )}
                </div>
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  {filterCount > 0 && <span>{filterCount} filter{filterCount !== 1 ? "s" : ""}</span>}
                  <span>•</span>
                  <span>{mappedTasks.length} task{mappedTasks.length !== 1 ? "s" : ""}</span>
                  <span>•</span>
                  <span>by {view.creator.name ?? "Unknown"}</span>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={handleToggleFavorite}
              >
                <Star
                  className={cn(
                    "h-4 w-4",
                    isFavorite ? "fill-yellow-400 text-yellow-400" : ""
                  )}
                />
              </Button>
              {view.isOwner && (
                <Button variant="ghost" size="icon" className="h-8 w-8">
                  <Settings className="h-4 w-4" />
                </Button>
              )}
            </div>
          </div>

          {view.description && (
            <p className="mt-2 text-sm text-muted-foreground">
              {view.description}
            </p>
          )}
        </div>

        <div className="flex-1 overflow-auto">
          <TaskList
            tasks={mappedTasks}
            loading={tasksLoading}
            selectedTaskId={selectedTaskId}
            onTaskClick={(task) => setSelectedTaskId(task.id)}
            emptyMessage="No tasks match this view's filters"
          />
        </div>
      </div>

      {selectedTask && (
        <div className="min-w-[24rem] w-[44rem] max-w-[70vw] border-l border-border">
          <TaskDetail
            task={{
              id: selectedTask.id,
              identifier: selectedTask.identifier,
              title: selectedTask.title,
              description: selectedTask.description,
              status: selectedTask.status as TaskStatus,
              priority: selectedTask.priority as TaskPriority,
              creator: selectedTask.creator,
              assignee: selectedTask.assignee,
              project: selectedTask.project,
              labels: selectedTask.labels,
              dueDate: selectedTask.dueDate,
              estimate: selectedTask.estimate,
              createdAt: selectedTask.createdAt,
              updatedAt: selectedTask.updatedAt,
              bobRun: selectedTask.bobRun,
              bobRunHistory,
              currentArtifacts: selectedTask.currentArtifacts,
              childArtifactGroups,
            }}
            onClose={() => setSelectedTaskId(null)}
            onStatusChange={handleStatusChange}
            onPriorityChange={handlePriorityChange}
          />
        </div>
      )}
    </div>
  );
}
