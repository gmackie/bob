"use client";

import { useState, useMemo } from "react";
import { useParams } from "next/navigation";
import { api } from "@/lib/trpc/client";
import { TaskList } from "@/components/tasks/task-list";
import { TaskDetail } from "@/components/tasks/task-detail";
import { useIssueBobContext } from "@/components/tasks/use-issue-bob-context";
import type { TaskStatus } from "@/components/tasks/status-badge";
import type { TaskPriority } from "@/components/tasks/priority-badge";
import { Clock, AlertTriangle } from "lucide-react";
import { Button } from "@linear-clone/ui/components/button";
import { cn } from "@linear-clone/ui/lib/utils";

const STALE_THRESHOLDS = [
  { value: "7", label: "7 days" },
  { value: "14", label: "14 days" },
  { value: "30", label: "30 days" },
];

export default function StaleTasksPage() {
  const params = useParams();
  const workspaceSlug = params.workspaceSlug as string;
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [staleDays, setStaleDays] = useState("14");

  const { data: workspace } = api.workspace.get.useQuery(
    { slug: workspaceSlug },
    { enabled: !!workspaceSlug }
  );

  const { data: tasks, isLoading } = api.issue.listAll.useQuery(
    {
      workspaceId: workspace?.id ?? "",
      filter: {
        status: ["backlog", "todo", "in_progress", "in_review"],
      },
      sort: { sortBy: "updatedAt", sortDirection: "desc" },
    },
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

  const utils = api.useUtils();

  const updateTaskMutation = api.issue.update.useMutation({
    onSuccess: () => {
      utils.issue.list.invalidate();
      utils.issue.get.invalidate();
    },
  });

  const handleStatusChange = async (status: TaskStatus) => {
    if (!selectedTaskId) return;
    await updateTaskMutation.mutateAsync({ id: selectedTaskId, status });
  };

  const handlePriorityChange = async (priority: TaskPriority) => {
    if (!selectedTaskId) return;
    await updateTaskMutation.mutateAsync({ id: selectedTaskId, priority });
  };

  const staleTasks = useMemo(() => {
    if (!tasks) return [];
    
    const thresholdMs = parseInt(staleDays) * 24 * 60 * 60 * 1000;
    const now = Date.now();
    
    return tasks
      .filter((task) => {
        const updatedAt = new Date(task.updatedAt).getTime();
        return (now - updatedAt) > thresholdMs;
      })
      .sort((a, b) => new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime())
      .map((task) => ({
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
        updatedAt: task.updatedAt,
        bobView: task.bobView,
      }));
  }, [tasks, staleDays]);

  const getDaysStale = (updatedAt: Date) => {
    const days = Math.floor((Date.now() - new Date(updatedAt).getTime()) / (24 * 60 * 60 * 1000));
    return days;
  };

  return (
    <div className="flex h-full">
      <div className="flex flex-1 flex-col overflow-hidden">
        <div className="border-b px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Clock className="h-5 w-5 text-orange-500" />
              <div>
                <h1 className="text-lg font-semibold">Stale Tasks</h1>
                <p className="text-sm text-muted-foreground">
                  {staleTasks.length} tasks haven&apos;t been updated in {staleDays}+ days
                </p>
              </div>
            </div>
            <div className="flex items-center gap-1">
              {STALE_THRESHOLDS.map((t) => (
                <Button
                  key={t.value}
                  variant="ghost"
                  size="sm"
                  className={cn(
                    "h-7 px-2 text-xs",
                    staleDays === t.value && "bg-muted font-medium"
                  )}
                  onClick={() => setStaleDays(t.value)}
                >
                  {t.label}
                </Button>
              ))}
            </div>
          </div>
        </div>

        <div className="flex-1 overflow-auto">
          {staleTasks.length > 0 ? (
            <TaskList
              tasks={staleTasks}
              loading={isLoading}
              selectedTaskId={selectedTaskId}
              onTaskClick={(task) => setSelectedTaskId(task.id)}
              emptyMessage="No stale tasks"
              actions={(task) => {
                const days = getDaysStale(task.createdAt);
                return (
                  <div className="flex items-center gap-1 text-orange-500">
                    <AlertTriangle className="h-3.5 w-3.5" />
                    <span className="text-xs font-medium">{days}d</span>
                  </div>
                );
              }}
            />
          ) : (
            <div className="flex flex-col items-center justify-center h-64 text-center">
              <Clock className="h-12 w-12 text-muted-foreground/30 mb-4" />
              <h3 className="font-medium text-muted-foreground">No stale tasks</h3>
              <p className="text-sm text-muted-foreground/70 mt-1">
                All tasks have been updated within the last {staleDays} days
              </p>
            </div>
          )}
        </div>
      </div>

      {selectedTask && (
        <div className="min-w-[24rem] w-[44rem] max-w-[70vw] border-l">
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
              gitLinks: selectedTask.gitLinks,
              bobRun: selectedTask.bobRun,
              bobRunHistory,
              currentArtifacts: selectedTask.currentArtifacts,
              childArtifactGroups,
              activities: selectedTask.activities,
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
