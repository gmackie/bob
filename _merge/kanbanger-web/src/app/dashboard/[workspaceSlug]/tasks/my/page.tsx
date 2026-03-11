"use client";

import { useState } from "react";
import { useParams } from "next/navigation";
import { api } from "@/lib/trpc/client";
import { TaskList } from "@/components/tasks/task-list";
import { TaskDetail } from "@/components/tasks/task-detail";
import { useIssueBobContext } from "@/components/tasks/use-issue-bob-context";
import type { TaskStatus } from "@/components/tasks/status-badge";
import type { TaskPriority } from "@/components/tasks/priority-badge";
import { ListTodo } from "lucide-react";

export default function MyTasksPage() {
  const params = useParams();
  const workspaceSlug = params.workspaceSlug as string;
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);

  const { data: workspace } = api.workspace.get.useQuery(
    { slug: workspaceSlug },
    { enabled: !!workspaceSlug }
  );

  const { data: user } = api.user.me.useQuery();

  const { data: tasks, isLoading } = api.issue.listAll.useQuery(
    {
      workspaceId: workspace?.id ?? "",
      filter: {
        assigneeId: user?.id,
        status: ["todo", "in_progress", "in_review"],
      },
      sort: { sortBy: "updatedAt", sortDirection: "desc" },
    },
    { enabled: !!workspace?.id && !!user?.id }
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

  const mappedTasks = tasks?.map((task) => ({
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
  })) ?? [];

  return (
    <div className="flex h-full">
      <div className="flex flex-1 flex-col overflow-hidden">
        <div className="border-b px-6 py-4">
          <div className="flex items-center gap-3">
            <ListTodo className="h-5 w-5 text-muted-foreground" />
            <div>
              <h1 className="text-lg font-semibold">My Tasks</h1>
              <p className="text-sm text-muted-foreground">
                {mappedTasks.length} active tasks assigned to you
              </p>
            </div>
          </div>
        </div>

        <div className="flex-1 overflow-auto">
          <TaskList
            tasks={mappedTasks}
            loading={isLoading}
            selectedTaskId={selectedTaskId}
            onTaskClick={(task) => setSelectedTaskId(task.id)}
            emptyMessage="No tasks assigned to you"
          />
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
