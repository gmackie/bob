"use client";

import { useState, useMemo, useCallback, useEffect } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { api } from "@/lib/trpc/client";
import { TaskList } from "@/components/tasks/task-list";
import { TaskDetail } from "@/components/tasks/task-detail";
import { useIssueBobContext } from "@/components/tasks/use-issue-bob-context";
import type { TaskStatus } from "@/components/tasks/status-badge";
import type { TaskPriority } from "@/components/tasks/priority-badge";
import { Lightbulb, Wifi, WifiOff } from "lucide-react";
import { useIssueUpdates } from "@linear-clone/realtime/sse-client";

interface IdeaTask {
  id: string;
  identifier: string;
  title: string;
  status: TaskStatus;
  priority: TaskPriority;
  assignee?: {
    id: string;
    name: string | null;
    avatarUrl: string | null;
    isAgent?: boolean;
  } | null;
  labels?: Array<{
    id: string;
    name: string;
    color: string;
  }>;
  project?: {
    id: string;
    name: string;
    color: string | null;
  } | null;
  dueDate?: Date | null;
  createdAt: Date;
  updatedAt: Date;
  funnelArtifactType?: string | null;
  funnelStage?: string | null;
}

interface IdeaSummary {
  stage: string;
  label: string;
  tasks: IdeaTask[];
}

const funnelArtifactOrder = [
  "idea",
  "plan",
  "brd",
  "spec",
  "task",
  "pr",
  "release",
] as const;

const funnelStageOrder = [
  "dumped",
  "triaged",
  "planned",
  "designed",
  "ready_for_execution",
  "picked_up",
  "staging_deployed",
  "staging_verified",
  "production_deployed",
] as const;

const funnelStageLabels: Record<string, string> = {
  dumped: "Dumped",
  triaged: "Triaged",
  planned: "Planned",
  designed: "Designed",
  ready_for_execution: "Ready for Execution",
  picked_up: "Picked Up",
  staging_deployed: "Staging Deployed",
  staging_verified: "Staging Verified",
  production_deployed: "Production Deployed",
};

const funnelArtifactLabels: Record<string, string> = {
  idea: "Idea",
  plan: "Plan",
  brd: "BRD",
  spec: "Spec",
  task: "Task",
  pr: "PR",
  release: "Release",
};

const documentRequestTemplates: Record<string, string> = {
  brd: "Please generate/update the BRD for this initiative and include assumptions, risks, and acceptance criteria.",
  detailed_requirements: "Please produce detailed requirements for this initiative, including edge cases and constraints.",
  design_docs: "Please draft an updated design doc for implementation and architecture for this initiative.",
  tasks: "Please break this initiative into implementation tasks with clear dependencies.",
  team_paradigms: "Please align this initiative with current team paradigms/workflows and call out any process changes.",
};

export default function IdeasTasksPage() {
  const params = useParams();
  const workspaceSlug = params.workspaceSlug as string;
  const searchParams = useSearchParams();
  const issueFromQuery = searchParams.get("issue");

  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [artifactFilter, setArtifactFilter] = useState<string>("all");
  const [stageFilter, setStageFilter] = useState<string>("all");

  const { data: workspace } = api.workspace.get.useQuery(
    { slug: workspaceSlug },
    { enabled: !!workspaceSlug }
  );

  const { data: tasks, isLoading } = api.issue.listAll.useQuery(
    {
      workspaceId: workspace?.id ?? "",
      filter: {
        status: ["backlog", "todo", "in_progress", "in_review", "done"],
        funnelArtifactType: ["idea", "plan", "brd", "spec", "task"],
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

  const { data: comments, isLoading: commentsLoading } = api.comment.list.useQuery(
    { issueId: selectedTaskId ?? "" },
    { enabled: !!selectedTaskId }
  );

  const { data: currentUserData } = api.user.me.useQuery();

  const utils = api.useUtils();

  const createCommentMutation = api.comment.create.useMutation({
    onSuccess: () => {
      utils.comment.list.invalidate();
    },
  });

  const updateCommentMutation = api.comment.update.useMutation({
    onSuccess: () => {
      utils.comment.list.invalidate();
    },
  });

  const deleteCommentMutation = api.comment.delete.useMutation({
    onSuccess: () => {
      utils.comment.list.invalidate();
    },
  });

  const addReactionMutation = api.comment.addReaction.useMutation({
    onSuccess: () => {
      utils.comment.list.invalidate();
    },
  });

  const updateTaskMutation = api.issue.update.useMutation({
    onSuccess: () => {
      utils.issue.list.invalidate();
      utils.issue.get.invalidate();
    },
  });

  const handleIssueCreated = useCallback(() => {
    utils.issue.list.invalidate();
  }, [utils]);

  const handleIssueUpdated = useCallback(() => {
    utils.issue.list.invalidate();
    utils.issue.get.invalidate();
    utils.comment.list.invalidate();
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

  const mappedTasks = useMemo<IdeaTask[]>(() => {
    if (!tasks) return [];
    return tasks.map((task) => ({
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
      funnelArtifactType: (task as unknown as { funnelArtifactType?: string | null }).funnelArtifactType,
      funnelStage: (task as unknown as { funnelStage?: string | null }).funnelStage,
    }));
  }, [tasks]);

  const visibleTasks = useMemo<IdeaTask[]>(() => {
    if (artifactFilter === "all" && stageFilter === "all") {
      return mappedTasks;
    }

    return mappedTasks.filter((task) => {
      const artifactMatch = artifactFilter === "all" ? true : task.funnelArtifactType === artifactFilter;
      const stageMatch = stageFilter === "all" ? true : task.funnelStage === stageFilter;
      return artifactMatch && stageMatch;
    });
  }, [artifactFilter, mappedTasks, stageFilter]);

  useEffect(() => {
    if (issueFromQuery) {
      setSelectedTaskId(issueFromQuery);
    }
  }, [issueFromQuery]);

  const stageSummaries = useMemo<IdeaSummary[]>(() => {
    const bucketMap = new Map<string, IdeaTask[]>(
      funnelStageOrder.map((stage) => [stage, []])
    );
    const unbucketed: IdeaTask[] = [];

    for (const task of visibleTasks) {
      const stage = task.funnelStage ?? "";
      const list = bucketMap.get(stage);
      if (list) {
        list.push(task);
      } else {
        unbucketed.push(task);
      }
    }

    const ordered = funnelStageOrder.map((stage) => ({
      stage,
      label: funnelStageLabels[stage] ?? stage,
      tasks: bucketMap.get(stage)?.sort(
        (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
      ) ?? [],
    }));

    if (unbucketed.length === 0) {
      return ordered;
    }

    return [
      ...ordered,
      {
        stage: "unstaged",
        label: "Unstaged",
        tasks: unbucketed.sort(
          (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
        ),
      },
    ];
  }, [visibleTasks]);

  const selectedArtifactLabel =
    artifactFilter === "all" ? "All Artifacts" : (funnelArtifactLabels[artifactFilter] ?? artifactFilter);
  const selectedStageLabel =
    stageFilter === "all" ? "All Stages" : (funnelStageLabels[stageFilter] ?? stageFilter);

  const handleSubmitComment = async (body: string, parentId?: string) => {
    if (!selectedTaskId) return;
    await createCommentMutation.mutateAsync({
      issueId: selectedTaskId,
      body,
      parentId,
    });
  };

  const handleEditComment = async (commentId: string, body: string) => {
    await updateCommentMutation.mutateAsync({ id: commentId, body });
  };

  const handleDeleteComment = async (commentId: string) => {
    await deleteCommentMutation.mutateAsync({ id: commentId });
  };

  const handleAddCommentReaction = async (commentId: string, emoji: string) => {
    await addReactionMutation.mutateAsync({ commentId, emoji });
  };

  const handleRequestDoc = useCallback(
    async (docType: string) => {
      if (!selectedTaskId || !selectedTask) return;
      const template = documentRequestTemplates[docType] ?? `Please provide ${docType} for this initiative.`;
      const body =
        `${template}\n\n` +
        `Context:\n- Issue: ${selectedTask.identifier}\n- Title: ${selectedTask.title}\n` +
        `- Artifact: ${selectedTask.funnelArtifactType ?? "Unknown"}\n- Stage: ${selectedTask.funnelStage ?? "Unstaged"}`;

      await createCommentMutation.mutateAsync({
        issueId: selectedTaskId,
        body,
      });
    },
    [createCommentMutation, selectedTask, selectedTaskId]
  );

  const handleStatusChange = async (status: TaskStatus) => {
    if (!selectedTaskId) return;
    await updateTaskMutation.mutateAsync({ id: selectedTaskId, status });
  };

  const handlePriorityChange = async (priority: TaskPriority) => {
    if (!selectedTaskId) return;
    await updateTaskMutation.mutateAsync({ id: selectedTaskId, priority });
  };

  return (
    <div className="flex h-full">
      <div className="flex flex-1 flex-col overflow-hidden">
        <div className="border-b px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Lightbulb className="h-5 w-5 text-muted-foreground" />
              <div>
                <h1 className="text-lg font-semibold">Ideas Funnel</h1>
                <p className="text-sm text-muted-foreground">
                  Monitor initiative and docs progression across left-of-funnel stages.
                </p>
              </div>
            </div>
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              {isConnected ? (
                <>
                  <Wifi className="h-3.5 w-3.5 text-green-500" />
                  <span>Real-time connected</span>
                </>
              ) : (
                <>
                  <WifiOff className="h-3.5 w-3.5" />
                  <span>Disconnected</span>
                </>
              )}
            </div>
          </div>
        </div>

        <div className="flex-1 overflow-auto p-4">
          <div className="mb-3 flex flex-wrap gap-2">
            <label className="text-xs text-muted-foreground inline-flex items-center gap-2">
              Artifact:
              <select
                className="rounded border border-border bg-background px-2 py-1 text-xs"
                value={artifactFilter}
                onChange={(event) => setArtifactFilter(event.target.value)}
              >
                <option value="all">All</option>
                {funnelArtifactOrder.map((artifact) => (
                  <option key={artifact} value={artifact}>
                    {funnelArtifactLabels[artifact] ?? artifact}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs text-muted-foreground inline-flex items-center gap-2">
              Stage:
              <select
                className="rounded border border-border bg-background px-2 py-1 text-xs"
                value={stageFilter}
                onChange={(event) => setStageFilter(event.target.value)}
              >
                <option value="all">All</option>
                {funnelStageOrder.map((stage) => (
                  <option key={stage} value={stage}>
                    {funnelStageLabels[stage]}
                  </option>
                ))}
              </select>
            </label>
            <div className="ml-auto text-xs text-muted-foreground flex items-center gap-2">
              <span>{selectedArtifactLabel}</span>
              <span>•</span>
              <span>{selectedStageLabel}</span>
              <span>•</span>
              <span>{visibleTasks.length} issues</span>
            </div>
          </div>

          {visibleTasks.length === 0 && !isLoading ? (
            <div className="flex h-full flex-col items-center justify-center text-center text-sm text-muted-foreground">
              <p>No issues found for this view.</p>
              <p className="text-xs mt-1">
                Adjust the funnel filters or use your ingestion path to create issues with funnel metadata.
              </p>
            </div>
          ) : (
            <div className="flex flex-nowrap gap-3">
              {stageSummaries.map((summary) => (
                <div
                  key={summary.stage}
                  className="min-w-[280px] flex-1 rounded-md border bg-background"
                >
                  <div className="flex items-center justify-between border-b px-3 py-2">
                    <h3 className="text-sm font-medium">{summary.label}</h3>
                    <span className="text-xs text-muted-foreground">{summary.tasks.length}</span>
                  </div>

                  <div className="h-[calc(100vh-190px)] overflow-y-auto">
                    {summary.tasks.length > 0 ? (
                      <TaskList
                        tasks={summary.tasks}
                        loading={isLoading}
                        selectedTaskId={selectedTaskId}
                        showUpdatedAt
                        onTaskClick={(task) => setSelectedTaskId(task.id)}
                      />
                    ) : (
                      <div className="py-8 px-3 text-xs text-muted-foreground text-center">
                        No issues in {summary.label}
                      </div>
                    )}
                  </div>
                </div>
              ))}
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
              funnelArtifactType: (selectedTask as unknown as { funnelArtifactType?: string | null })
                .funnelArtifactType,
              funnelStage: (selectedTask as unknown as { funnelStage?: string | null }).funnelStage,
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
            comments={comments?.map((comment) => ({
              id: comment.id,
              body: comment.body,
              edited: comment.edited,
              createdAt: comment.createdAt,
              user: comment.user,
              reactions: comment.reactions,
              replies: comment.replies?.map((reply) => ({
                id: reply.id,
                body: reply.body,
                edited: reply.edited,
                createdAt: reply.createdAt,
                user: reply.user,
                reactions: reply.reactions ?? [],
              })) ?? [],
            })) ?? []}
            commentsLoading={commentsLoading}
            currentUser={currentUserData ? {
              id: currentUserData.id,
              name: currentUserData.name,
              avatarUrl: currentUserData.avatarUrl,
            } : undefined}
            onSubmitComment={handleSubmitComment}
            onEditComment={handleEditComment}
            onDeleteComment={handleDeleteComment}
            onAddCommentReaction={handleAddCommentReaction}
            onRequestDoc={handleRequestDoc}
            onStatusChange={handleStatusChange}
            onPriorityChange={handlePriorityChange}
          />
        </div>
      )}
    </div>
  );
}
