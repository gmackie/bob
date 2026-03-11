"use client";

import { useState, useMemo, useCallback } from "react";
import { useParams } from "next/navigation";
import { api } from "@/lib/trpc/client";
import { KanbanBoard } from "@/components/tasks/kanban-board";
import { TaskDetail } from "@/components/tasks/task-detail";
import { useIssueBobContext } from "@/components/tasks/use-issue-bob-context";
import type { TaskStatus } from "@/components/tasks/status-badge";
import type { TaskPriority } from "@/components/tasks/priority-badge";
import { Kanban, Settings2, Wifi, WifiOff } from "lucide-react";
import { Button } from "@linear-clone/ui/components/button";
import { Checkbox } from "@linear-clone/ui/components/checkbox";
import { Label } from "@linear-clone/ui/components/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@linear-clone/ui/components/popover";
import {
  KanbanFilterToolbar,
  type KanbanFilters,
} from "@/components/tasks/kanban-filter-toolbar";
import { isPast, isWithinInterval, addDays } from "date-fns";
import { useIssueUpdates } from "@linear-clone/realtime/sse-client";

const defaultFilters: KanbanFilters = {
  search: "",
  projectIds: [],
  assigneeIds: [],
  labelIds: [],
  dueDateFilter: "all",
  myIssuesOnly: false,
};

export default function AllTasksPage() {
  const params = useParams();
  const workspaceSlug = params.workspaceSlug as string;
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [showBacklog, setShowBacklog] = useState(true);
  const [showClosed, setShowClosed] = useState(false);
  const [filters, setFilters] = useState<KanbanFilters>(defaultFilters);

  const { data: workspace } = api.workspace.get.useQuery(
    { slug: workspaceSlug },
    { enabled: !!workspaceSlug }
  );

  const { data: currentUser } = api.user.me.useQuery();

  const { data: tasks, isLoading } = api.issue.listAll.useQuery(
    {
      workspaceId: workspace?.id ?? "",
      filter: {
        assigneeId: filters.myIssuesOnly ? currentUser?.id : undefined,
        projectId: filters.projectIds.length === 1 ? filters.projectIds[0] : undefined,
        search: filters.search || undefined,
        labelIds: filters.labelIds.length > 0 ? filters.labelIds : undefined,
      },
      sort: { sortBy: "updatedAt", sortDirection: "desc" },
    },
    { enabled: !!workspace?.id }
  );

  const { data: projects } = api.project.list.useQuery(
    { workspaceId: workspace?.id ?? "" },
    { enabled: !!workspace?.id }
  );

  const { data: workspaceMembers } = api.workspace.members.useQuery(
    { workspaceId: workspace?.id ?? "" },
    { enabled: !!workspace?.id }
  );

  const { data: labels } = api.label.listFlat.useQuery(
    { workspaceId: workspace?.id ?? "" },
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

  const reorderMutation = api.issue.reorder.useMutation({
    onSuccess: () => {
      utils.issue.list.invalidate();
    },
  });

  const handleIssueCreated = useCallback(() => {
    utils.issue.list.invalidate();
  }, [utils]);

  const handleIssueUpdated = useCallback(() => {
    utils.issue.list.invalidate();
    utils.issue.get.invalidate();
  }, [utils]);

  const handleIssueDeleted = useCallback(() => {
    utils.issue.list.invalidate();
    setSelectedTaskId(null);
  }, [utils]);

  const { isConnected } = useIssueUpdates(workspace?.id ?? "", {
    onIssueCreated: handleIssueCreated,
    onIssueUpdated: handleIssueUpdated,
    onIssueDeleted: handleIssueDeleted,
  });

  const handleStatusChange = async (taskId: string, newStatus: TaskStatus) => {
    await updateTaskMutation.mutateAsync({ id: taskId, status: newStatus });
  };

  const handleReorder = async (taskId: string, newStatus: TaskStatus, newRank: string) => {
    await reorderMutation.mutateAsync({
      issueId: taskId,
      status: newStatus,
      kanbanRank: newRank,
    });
  };

  const handleTaskStatusChange = async (status: TaskStatus) => {
    if (!selectedTaskId) return;
    await updateTaskMutation.mutateAsync({ id: selectedTaskId, status });
  };

  const handlePriorityChange = async (priority: TaskPriority) => {
    if (!selectedTaskId) return;
    await updateTaskMutation.mutateAsync({ id: selectedTaskId, priority });
  };

  const filteredTasks = useMemo(() => {
    if (!tasks) return [];

    return tasks.filter((task) => {
      if (filters.projectIds.length > 1) {
        if (!filters.projectIds.includes(task.project?.id ?? "")) return false;
      }

      if (filters.assigneeIds.length > 0) {
        if (!task.assignee || !filters.assigneeIds.includes(task.assignee.id)) return false;
      }

      if (filters.dueDateFilter !== "all") {
        const dueDate = task.dueDate ? new Date(task.dueDate) : null;
        if (filters.dueDateFilter === "none" && dueDate) return false;
        if (filters.dueDateFilter === "overdue") {
          if (!dueDate || !isPast(dueDate)) return false;
        }
        if (filters.dueDateFilter === "next7d") {
          if (!dueDate) return false;
          const now = new Date();
          const in7Days = addDays(now, 7);
          if (!isWithinInterval(dueDate, { start: now, end: in7Days })) return false;
        }
      }

      return true;
    });
  }, [tasks, filters]);

  const mappedTasks = filteredTasks.map((task) => ({
    id: task.id,
    identifier: task.identifier,
    title: task.title,
    status: task.status as TaskStatus,
    priority: task.priority as TaskPriority,
    kanbanRank: (task as unknown as { kanbanRank?: string | null }).kanbanRank,
    assignee: task.assignee,
    labels: task.labels,
    project: task.project,
    dueDate: task.dueDate,
    bobView: task.bobView,
  }));

  const projectList = projects?.map((p) => ({
    id: p.project.id,
    name: p.project.name,
    color: p.project.color,
  })) ?? [];

  const userList = workspaceMembers?.map((m) => ({
    id: m.user.id,
    name: m.user.name,
    avatarUrl: m.user.avatarUrl,
  })) ?? [];

  const labelList = labels?.map((l) => ({
    id: l.id,
    name: l.name,
    color: l.color,
  })) ?? [];

  const title = filters.myIssuesOnly ? "My Issues" : "All Issues";

  return (
    <div className="flex h-full">
      <div className="flex flex-1 flex-col overflow-hidden">
        <div className="border-b px-6 py-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Kanban className="h-5 w-5 text-muted-foreground" />
              <div>
                <h1 className="text-lg font-semibold">{title}</h1>
                <p className="text-sm text-muted-foreground">
                  {mappedTasks.length} tasks across all projects
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {workspace?.id && (
                <div
                  className="flex items-center gap-1.5 text-xs text-muted-foreground"
                  title={isConnected ? "Real-time updates connected" : "Real-time updates disconnected"}
                >
                  {isConnected ? (
                    <Wifi className="h-3.5 w-3.5 text-green-500" />
                  ) : (
                    <WifiOff className="h-3.5 w-3.5 text-muted-foreground" />
                  )}
                </div>
              )}
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="ghost" size="sm">
                    <Settings2 className="mr-1 h-4 w-4" />
                    View
                  </Button>
                </PopoverTrigger>
              <PopoverContent className="w-48" align="end">
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <Checkbox
                      id="show-backlog"
                      checked={showBacklog}
                      onCheckedChange={(checked) => setShowBacklog(checked === true)}
                    />
                    <Label htmlFor="show-backlog" className="text-sm">
                      Show backlog
                    </Label>
                  </div>
                  <div className="flex items-center gap-2">
                    <Checkbox
                      id="show-closed"
                      checked={showClosed}
                      onCheckedChange={(checked) => setShowClosed(checked === true)}
                    />
                    <Label htmlFor="show-closed" className="text-sm">
                      Show completed
                    </Label>
                  </div>
                </div>
              </PopoverContent>
              </Popover>
            </div>
          </div>

          <KanbanFilterToolbar
            filters={filters}
            onFiltersChange={setFilters}
            projects={projectList}
            users={userList}
            labels={labelList}
            currentUserId={currentUser?.id}
          />
        </div>

        <div className="flex-1 overflow-hidden">
          <KanbanBoard
            tasks={mappedTasks}
            loading={isLoading}
            onTaskClick={(task) => setSelectedTaskId(task.id)}
            onStatusChange={handleStatusChange}
            onReorder={handleReorder}
            showBacklog={showBacklog}
            showClosed={showClosed}
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
            onStatusChange={handleTaskStatusChange}
            onPriorityChange={handlePriorityChange}
          />
        </div>
      )}
    </div>
  );
}
