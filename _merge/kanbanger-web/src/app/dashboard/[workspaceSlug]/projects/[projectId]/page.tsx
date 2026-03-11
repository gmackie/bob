"use client";

import { useState, useCallback, useEffect } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { api } from "@/lib/trpc/client";
import { Button } from "@linear-clone/ui/components/button";
import { Progress } from "@linear-clone/ui/components/progress";
import { Tabs, TabsList, TabsTrigger } from "@linear-clone/ui/components/tabs";
import { TaskList } from "@/components/tasks/task-list";
import { TaskDetail } from "@/components/tasks/task-detail";
import { useIssueBobContext } from "@/components/tasks/use-issue-bob-context";
import { KanbanBoard } from "@/components/tasks/kanban-board";
import { CreateTaskModal } from "@/components/tasks/create-task-modal";
import { ProjectSettingsModal } from "@/components/projects/project-settings-modal";
import { statusConfig, type TaskStatus } from "@/components/tasks/status-badge";
import type { TaskPriority } from "@/components/tasks/priority-badge";
import type { ProjectViewTab } from "@linear-clone/store";
import { useHydrated, usePreferencesStore } from "@linear-clone/store/web";
import {
  Plus,
  ArrowLeft,
  Settings,
  FolderKanban,
  Calendar,
  LayoutList,
  Kanban,
  Wifi,
  WifiOff,
  FileText,
  Pencil,
  Trash2,
} from "lucide-react";
import { useIssueUpdates } from "@linear-clone/realtime/sse-client";

type StatusFilter = "all" | TaskStatus;

const PROJECT_VIEW_TABS: ProjectViewTab[] = ["list", "board", "overview", "documents"];

function isProjectViewTab(value: string | null): value is ProjectViewTab {
  return value !== null && (PROJECT_VIEW_TABS as readonly string[]).includes(value);
}

export default function ProjectDetailPage() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const hydrated = useHydrated();
  const workspaceSlug = params.workspaceSlug as string;
  const projectId = params.projectId as string;

  const projectViewById = usePreferencesStore((s) => s.projectViewById);
  const setProjectViewForProject = usePreferencesStore((s) => s.setProjectViewForProject);
  const preferredView = projectViewById[projectId];

  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [activeTab, setActiveTab] = useState<ProjectViewTab>("list");
  const [showDocModal, setShowDocModal] = useState(false);
  const [editingDoc, setEditingDoc] = useState<{ id: string; title: string; content: string; type: string } | null>(null);
  const [docTitle, setDocTitle] = useState("");
  const [docContent, setDocContent] = useState("");
  const [docType, setDocType] = useState<"planning" | "roadmap" | "spec" | "design" | "notes" | "other">("planning");

  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");

  const { data: workspace } = api.workspace.get.useQuery(
    { slug: workspaceSlug },
    { enabled: !!workspaceSlug }
  );

  const { data: projectData, isLoading: projectLoading } = api.project.get.useQuery(
    { id: projectId },
    { enabled: !!projectId }
  );

  const { data: labelsData } = api.label.listFlat.useQuery(
    { workspaceId: workspace?.id ?? "" },
    { enabled: !!workspace?.id }
  );

  const { data: tasks, isLoading: tasksLoading } = api.issue.listAll.useQuery(
    {
      workspaceId: workspace?.id ?? "",
      filter: {
        projectId,
        status: statusFilter === "all" ? undefined : [statusFilter],
      },
      sort: { sortBy: "updatedAt", sortDirection: "desc" },
    },
    { enabled: !!workspace?.id && !!projectId }
  );

  const { data: selectedTask } = api.issue.get.useQuery(
    { id: selectedTaskId ?? "" },
    { enabled: !!selectedTaskId }
  );
  const { bobRunHistory, childArtifactGroups } = useIssueBobContext(
    selectedTaskId,
    selectedTask?.subIssuesCount ?? 0
  );

  const { data: subTasks, isLoading: subTasksLoading } = api.issue.subIssues.useQuery(
    { parentId: selectedTaskId ?? "" },
    { enabled: !!selectedTaskId }
  );

  const { data: dependencies, isLoading: dependenciesLoading } = api.dependency.list.useQuery(
    { issueId: selectedTaskId ?? "" },
    { enabled: !!selectedTaskId }
  );

  const [dependencySearchQuery, setDependencySearchQuery] = useState("");

  const { data: dependencySearchResults, isFetching: isDependencySearching } = api.issue.list.useQuery(
    {
      workspaceId: workspace?.id ?? "",
      filter: { search: dependencySearchQuery, projectId },
      pagination: { limit: 10, offset: 0, sortBy: "updatedAt", sortDirection: "desc" },
    },
    { enabled: !!workspace?.id && dependencySearchQuery.length > 1 }
  );

  const { data: comments, isLoading: commentsLoading } = api.comment.list.useQuery(
    { issueId: selectedTaskId ?? "" },
    { enabled: !!selectedTaskId }
  );

  const { data: currentUserData } = api.user.me.useQuery();

  const { data: cycles, isLoading: cyclesLoading } = api.cycle.listByWorkspace.useQuery(
    { workspaceId: workspace?.id ?? "" },
    { enabled: !!workspace?.id }
  );

  const { data: documents, isLoading: documentsLoading } = api.projectDocument.list.useQuery(
    { projectId },
    { enabled: !!projectId }
  );

  const utils = api.useUtils();

  const updateProjectMutation = api.project.update.useMutation({
    onSuccess: () => {
      utils.project.get.invalidate();
      utils.project.list.invalidate();
    },
  });

  const deleteProjectMutation = api.project.delete.useMutation({
    onSuccess: () => {
      utils.project.list.invalidate();
      router.push(`/dashboard/${workspaceSlug}/projects`);
    },
  });

  const createTaskMutation = api.issue.create.useMutation({
    onSuccess: () => {
      utils.issue.list.invalidate();
      setShowCreateModal(false);
    },
  });

  const updateTaskMutation = api.issue.update.useMutation({
    onSuccess: () => {
      utils.issue.list.invalidate();
      utils.issue.get.invalidate();
      utils.issue.subIssues.invalidate();
    },
  });

  const createSubTaskMutation = api.issue.create.useMutation({
    onSuccess: () => {
      utils.issue.subIssues.invalidate();
      utils.issue.get.invalidate();
    },
  });

  const addDependencyMutation = api.dependency.add.useMutation({
    onSuccess: () => {
      utils.dependency.list.invalidate();
    },
  });

  const removeDependencyMutation = api.dependency.remove.useMutation({
    onSuccess: () => {
      utils.dependency.list.invalidate();
    },
  });

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

  const reorderMutation = api.issue.reorder.useMutation({
    onSuccess: () => {
      utils.issue.list.invalidate();
    },
  });

  const createDocMutation = api.projectDocument.create.useMutation({
    onSuccess: () => {
      utils.projectDocument.list.invalidate();
      setShowDocModal(false);
      setDocTitle("");
      setDocContent("");
      setDocType("planning");
    },
  });

  const updateDocMutation = api.projectDocument.update.useMutation({
    onSuccess: () => {
      utils.projectDocument.list.invalidate();
      setEditingDoc(null);
      setDocTitle("");
      setDocContent("");
      setDocType("planning");
    },
  });

  const deleteDocMutation = api.projectDocument.delete.useMutation({
    onSuccess: () => {
      utils.projectDocument.list.invalidate();
    },
  });

  const handleIssueCreated = useCallback(() => {
    utils.issue.list.invalidate();
  }, [utils]);

  const handleIssueUpdated = useCallback(() => {
    utils.issue.list.invalidate();
    utils.issue.get.invalidate();
    utils.issue.subIssues.invalidate();
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

  const handleReorder = async (taskId: string, newStatus: TaskStatus, newRank: string) => {
    await reorderMutation.mutateAsync({
      issueId: taskId,
      status: newStatus,
      kanbanRank: newRank,
    });
  };

  const syncUrlView = useCallback(
    (view: ProjectViewTab) => {
      const nextParams = new URLSearchParams(searchParams.toString());
      nextParams.set("view", view);

      const qs = nextParams.toString();
      const href = qs
        ? `/dashboard/${workspaceSlug}/projects/${projectId}?${qs}`
        : `/dashboard/${workspaceSlug}/projects/${projectId}`;

      router.replace(href, { scroll: false });
    },
    [projectId, router, searchParams, workspaceSlug]
  );

  useEffect(() => {
    if (!hydrated) return;

    const urlViewParam = searchParams.get("view");
    if (isProjectViewTab(urlViewParam)) {
      setActiveTab(urlViewParam);
      setProjectViewForProject(projectId, urlViewParam);
      return;
    }

    if (preferredView) {
      setActiveTab(preferredView);
      syncUrlView(preferredView);
    }
  }, [hydrated, preferredView, projectId, searchParams, setProjectViewForProject, syncUrlView]);

  const handleCreateTask = async (data: {
    projectId: string;
    title: string;
    description?: string;
    status: TaskStatus;
    priority: TaskPriority;
    assigneeId?: string;
    teamId?: string;
    labelIds?: string[];
  }) => {
    await createTaskMutation.mutateAsync({
      ...data,
      projectId,
    });
  };

  const handleStatusChange = async (status: TaskStatus) => {
    if (!selectedTaskId) return;
    await updateTaskMutation.mutateAsync({
      id: selectedTaskId,
      status,
    });
  };

  const handleBoardStatusChange = async (taskId: string, newStatus: TaskStatus) => {
    await updateTaskMutation.mutateAsync({
      id: taskId,
      status: newStatus,
    });
  };

  const handlePriorityChange = async (priority: TaskPriority) => {
    if (!selectedTaskId) return;
    await updateTaskMutation.mutateAsync({
      id: selectedTaskId,
      priority,
    });
  };

  const handleCreateSubTask = async (title: string) => {
    if (!selectedTaskId) return;
    await createSubTaskMutation.mutateAsync({
      projectId,
      parentId: selectedTaskId,
      title,
      status: "todo",
      priority: "no_priority",
    });
  };

  const handleSubTaskStatusChange = async (subTaskId: string, status: TaskStatus) => {
    await updateTaskMutation.mutateAsync({
      id: subTaskId,
      status,
    });
  };

  const handleAddBlockedBy = async (blockingIssueId: string) => {
    if (!selectedTaskId) return;
    await addDependencyMutation.mutateAsync({
      blockingIssueId,
      blockedIssueId: selectedTaskId,
    });
  };

  const handleAddBlocking = async (blockedIssueId: string) => {
    if (!selectedTaskId) return;
    await addDependencyMutation.mutateAsync({
      blockingIssueId: selectedTaskId,
      blockedIssueId,
    });
  };

  const handleRemoveDependency = async (dependencyId: string) => {
    await removeDependencyMutation.mutateAsync({ id: dependencyId });
  };

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

  const handleEstimateChange = async (estimate: number | null) => {
    if (!selectedTaskId) return;
    await updateTaskMutation.mutateAsync({
      id: selectedTaskId,
      estimate,
    });
  };

  const handleCycleChange = async (cycleId: string | null) => {
    if (!selectedTaskId) return;
    await updateTaskMutation.mutateAsync({
      id: selectedTaskId,
      cycleId,
    });
  };

  if (projectLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  if (!projectData || !projectData.project) {
    return (
      <div className="flex h-full flex-col items-center justify-center">
        <h1 className="text-xl font-semibold">Project not found</h1>
        <p className="mt-2 text-muted-foreground">
          The project you&apos;re looking for doesn&apos;t exist.
        </p>
        <Button
          variant="link"
          onClick={() => router.push(`/dashboard/${workspaceSlug}/projects`)}
        >
          Go back to projects
        </Button>
      </div>
    );
  }

  const project = projectData.project;
  const taskCount = projectData.issueCount ?? 0;
  const completedCount = projectData.completedCount ?? 0;
  const progress = taskCount > 0 ? Math.round((completedCount / taskCount) * 100) : 0;

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
    updatedAt: task.updatedAt,
    bobView: task.bobView,
  })) ?? [];

  return (
    <div className="flex h-full">
      <div className="flex flex-1 flex-col overflow-hidden">
        <div className="border-b border-border px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={() => router.push(`/dashboard/${workspaceSlug}/projects`)}
              >
                <ArrowLeft className="h-4 w-4" />
              </Button>
              <div
                className="flex h-8 w-8 items-center justify-center rounded-lg"
                style={{ backgroundColor: `${project.color ?? "#6366f1"}20` }}
              >
                <FolderKanban
                  className="h-4 w-4"
                  style={{ color: project.color ?? "#6366f1" }}
                />
              </div>
              <div>
                <h1 className="text-lg font-semibold">{project.name}</h1>
                <p className="text-xs text-muted-foreground">{project.key}</p>
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
              <Button 
                variant="ghost" 
                size="icon" 
                className="h-8 w-8"
                onClick={() => setShowSettingsModal(true)}
              >
                <Settings className="h-4 w-4" />
              </Button>
              <Button size="sm" onClick={() => setShowCreateModal(true)}>
                <Plus className="mr-1 h-4 w-4" />
                New task
              </Button>
            </div>
          </div>

          <Tabs
            value={activeTab}
            onValueChange={(v) => {
              const next = v as ProjectViewTab;
              setActiveTab(next);
              setProjectViewForProject(projectId, next);
              syncUrlView(next);
            }}
            className="mt-4"
          >
            <TabsList>
              <TabsTrigger value="list" className="gap-1.5">
                <LayoutList className="h-3.5 w-3.5" />
                List
              </TabsTrigger>
              <TabsTrigger value="board" className="gap-1.5">
                <Kanban className="h-3.5 w-3.5" />
                Board
              </TabsTrigger>
              <TabsTrigger value="overview">Overview</TabsTrigger>
              <TabsTrigger value="documents" className="gap-1.5">
                <FileText className="h-3.5 w-3.5" />
                Docs
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </div>

        {activeTab === "list" && (
          <div className="flex-1 overflow-auto">
            <div className="flex items-center gap-3 border-b border-border px-4 py-2">
              <span className="text-xs text-muted-foreground">Status</span>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
                className="rounded-md border border-input bg-background px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-primary"
              >
                <option value="all">All</option>
                {Object.entries(statusConfig).map(([key, cfg]) => (
                  <option key={key} value={key}>
                    {cfg.label}
                  </option>
                ))}
              </select>
            </div>
            <TaskList
              tasks={mappedTasks}
              loading={tasksLoading}
              selectedTaskId={selectedTaskId}
              onTaskClick={(task) => setSelectedTaskId(task.id)}
              emptyMessage="No tasks in this project"
              showStatusLabel={true}
              showUpdatedAt={true}
              showUpdatedBy={true}
            />
          </div>
        )}

        {activeTab === "board" && (
          <div className="flex-1 overflow-hidden">
            <KanbanBoard
              tasks={mappedTasks}
              loading={tasksLoading}
              onTaskClick={(task) => setSelectedTaskId(task.id)}
              onStatusChange={handleBoardStatusChange}
              onReorder={handleReorder}
              showBacklog={true}
              showClosed={false}
            />
          </div>
        )}

        {activeTab === "overview" && (
          <div className="flex-1 overflow-auto p-6">
            <div className="max-w-2xl space-y-6">
              {project.description && (
                <div>
                  <h3 className="mb-2 text-sm font-medium">Description</h3>
                  <p className="text-sm text-muted-foreground">
                    {project.description}
                  </p>
                </div>
              )}

              <div>
                <h3 className="mb-2 text-sm font-medium">Progress</h3>
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">
                      {completedCount} of {taskCount} tasks completed
                    </span>
                    <span className="font-medium">{progress}%</span>
                  </div>
                  <Progress value={progress} className="h-2" />
                </div>
              </div>

              <div className="space-y-3">
                {projectData.lead && (
                  <div className="flex items-center gap-4">
                    <span className="w-24 text-sm text-muted-foreground">Lead</span>
                    <div className="flex items-center gap-2">
                      <div className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-xs font-medium text-primary-foreground">
                        {projectData.lead.name?.charAt(0) ?? "?"}
                      </div>
                      <span className="text-sm">{projectData.lead.name}</span>
                    </div>
                  </div>
                )}

                {project.startDate && (
                  <div className="flex items-center gap-4">
                    <span className="w-24 text-sm text-muted-foreground">Start date</span>
                    <div className="flex items-center gap-2">
                      <Calendar className="h-4 w-4 text-muted-foreground" />
                      <span className="text-sm">
                        {new Date(project.startDate).toLocaleDateString("en-US", {
                          month: "short",
                          day: "numeric",
                          year: "numeric",
                        })}
                      </span>
                    </div>
                  </div>
                )}

                {project.targetDate && (
                  <div className="flex items-center gap-4">
                    <span className="w-24 text-sm text-muted-foreground">Target date</span>
                    <div className="flex items-center gap-2">
                      <Calendar className="h-4 w-4 text-muted-foreground" />
                      <span className="text-sm">
                        {new Date(project.targetDate).toLocaleDateString("en-US", {
                          month: "short",
                          day: "numeric",
                          year: "numeric",
                        })}
                      </span>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {activeTab === "documents" && (
          <div className="flex-1 overflow-auto p-6">
            <div className="max-w-4xl space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-medium">Project Documents</h3>
                <Button size="sm" onClick={() => {
                  setEditingDoc(null);
                  setDocTitle("");
                  setDocContent("");
                  setDocType("planning");
                  setShowDocModal(true);
                }}>
                  <Plus className="mr-1 h-4 w-4" />
                  New Document
                </Button>
              </div>

              {documentsLoading ? (
                <div className="flex items-center justify-center py-12">
                  <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
                </div>
              ) : !documents || documents.length === 0 ? (
                <div className="rounded-lg border border-dashed border-border p-8 text-center">
                  <FileText className="mx-auto h-12 w-12 text-muted-foreground/50" />
                  <h4 className="mt-4 text-sm font-medium">No documents yet</h4>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Create planning documents, specs, or roadmaps for this project.
                  </p>
                  <Button
                    variant="outline"
                    size="sm"
                    className="mt-4"
                    onClick={() => {
                      setEditingDoc(null);
                      setDocTitle("");
                      setDocContent("");
                      setDocType("planning");
                      setShowDocModal(true);
                    }}
                  >
                    <Plus className="mr-1 h-4 w-4" />
                    Create first document
                  </Button>
                </div>
              ) : (
                <div className="space-y-3">
                  {documents.map((doc) => (
                    <div
                      key={doc.id}
                      className="group rounded-lg border border-border bg-card p-4 hover:border-primary/50 transition-colors"
                    >
                      <div className="flex items-start justify-between">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <FileText className="h-4 w-4 text-muted-foreground" />
                            <h4 className="font-medium truncate">{doc.title}</h4>
                            <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-muted text-muted-foreground">
                              {doc.type}
                            </span>
                          </div>
                          {doc.content && (
                            <p className="mt-2 text-sm text-muted-foreground line-clamp-2 whitespace-pre-wrap">
                              {doc.content.slice(0, 200)}
                              {doc.content.length > 200 ? "..." : ""}
                            </p>
                          )}
                          <p className="mt-2 text-xs text-muted-foreground">
                            Updated {new Date(doc.updatedAt).toLocaleDateString("en-US", {
                              month: "short",
                              day: "numeric",
                              year: "numeric",
                              hour: "numeric",
                              minute: "2-digit",
                            })}
                          </p>
                        </div>
                        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            onClick={() => {
                              setEditingDoc({
                                id: doc.id,
                                title: doc.title,
                                content: doc.content ?? "",
                                type: doc.type,
                              });
                              setDocTitle(doc.title);
                              setDocContent(doc.content ?? "");
                              setDocType(doc.type as typeof docType);
                              setShowDocModal(true);
                            }}
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-destructive hover:text-destructive"
                            onClick={() => {
                              if (confirm("Are you sure you want to delete this document?")) {
                                deleteDocMutation.mutate({ id: doc.id });
                              }
                            }}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {showDocModal && (
              <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
                <div className="w-full max-w-2xl rounded-lg border border-border bg-background p-6 shadow-lg">
                  <h3 className="text-lg font-medium">
                    {editingDoc ? "Edit Document" : "Create Document"}
                  </h3>
                  <div className="mt-4 space-y-4">
                    <div>
                      <label className="block text-sm font-medium mb-1.5">Title</label>
                      <input
                        type="text"
                        value={docTitle}
                        onChange={(e) => setDocTitle(e.target.value)}
                        placeholder="Document title..."
                        className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium mb-1.5">Type</label>
                      <select
                        value={docType}
                        onChange={(e) => setDocType(e.target.value as typeof docType)}
                        className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                      >
                        <option value="planning">Planning</option>
                        <option value="roadmap">Roadmap</option>
                        <option value="spec">Spec</option>
                        <option value="design">Design</option>
                        <option value="notes">Notes</option>
                        <option value="other">Other</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-sm font-medium mb-1.5">Content</label>
                      <textarea
                        value={docContent}
                        onChange={(e) => setDocContent(e.target.value)}
                        placeholder="Write your document content here... (Markdown supported)"
                        rows={12}
                        className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary resize-none"
                      />
                    </div>
                  </div>
                  <div className="mt-6 flex justify-end gap-2">
                    <Button
                      variant="outline"
                      onClick={() => {
                        setShowDocModal(false);
                        setEditingDoc(null);
                        setDocTitle("");
                        setDocContent("");
                        setDocType("planning");
                      }}
                    >
                      Cancel
                    </Button>
                    <Button
                      disabled={!docTitle.trim() || createDocMutation.isPending || updateDocMutation.isPending}
                      onClick={() => {
                        if (editingDoc) {
                          updateDocMutation.mutate({
                            id: editingDoc.id,
                            title: docTitle.trim(),
                            content: docContent,
                            type: docType,
                          });
                        } else {
                          createDocMutation.mutate({
                            projectId,
                            title: docTitle.trim(),
                            content: docContent,
                            type: docType,
                          });
                        }
                      }}
                    >
                      {createDocMutation.isPending || updateDocMutation.isPending
                        ? "Saving..."
                        : editingDoc
                        ? "Update"
                        : "Create"}
                    </Button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
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
              cycleId: selectedTask.cycleId,
              createdAt: selectedTask.createdAt,
              updatedAt: selectedTask.updatedAt,
              gitLinks: selectedTask.gitLinks,
              bobRun: selectedTask.bobRun,
              bobRunHistory,
              currentArtifacts: selectedTask.currentArtifacts,
              childArtifactGroups,
              activities: selectedTask.activities,
              subIssuesCount: selectedTask.subIssuesCount,
              parent: selectedTask.parent,
            }}
            subTasks={subTasks?.map((t) => ({
              id: t.id,
              identifier: t.identifier,
              title: t.title,
              status: t.status as TaskStatus,
              priority: t.priority as TaskPriority,
              assignee: t.assignee,
            })) ?? []}
            subTasksLoading={subTasksLoading}
            dependencies={dependencies}
            dependenciesLoading={dependenciesLoading}
            dependencySearchResults={dependencySearchResults?.filter(
              (t) => t.id !== selectedTaskId
            ).map((t) => ({
              id: t.id,
              identifier: t.identifier,
              title: t.title,
              status: t.status,
              priority: t.priority,
            }))}
            isDependencySearching={isDependencySearching}
            onClose={() => setSelectedTaskId(null)}
            onStatusChange={handleStatusChange}
            onPriorityChange={handlePriorityChange}
            onCreateSubTask={handleCreateSubTask}
            onSubTaskStatusChange={handleSubTaskStatusChange}
            onSubTaskClick={(subTask) => setSelectedTaskId(subTask.id)}
            onParentClick={(parentId) => setSelectedTaskId(parentId)}
            onAddBlockedBy={handleAddBlockedBy}
            onAddBlocking={handleAddBlocking}
            onRemoveDependency={handleRemoveDependency}
            onDependencySearch={setDependencySearchQuery}
            onDependencyIssueClick={(issueId) => setSelectedTaskId(issueId)}
            comments={comments?.map((c) => ({
              id: c.id,
              body: c.body,
              edited: c.edited,
              createdAt: c.createdAt,
              user: c.user,
              reactions: c.reactions,
              replies: c.replies?.map((r) => ({
                id: r.id,
                body: r.body,
                edited: r.edited,
                createdAt: r.createdAt,
                user: r.user,
                reactions: r.reactions ?? [],
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
            onEstimateChange={handleEstimateChange}
            cycles={cycles?.map((c) => ({
              id: c.id,
              name: c.name,
              number: c.number,
              status: c.status,
              startDate: c.startDate,
              endDate: c.endDate,
            })) ?? []}
            cyclesLoading={cyclesLoading}
            onCycleChange={handleCycleChange}
          />
        </div>
      )}

      {showCreateModal && project && (
        <CreateTaskModal
          projects={[{ id: project.id, name: project.name, key: project.key ?? "", color: project.color }]}
          defaultProjectId={project.id}
          onClose={() => setShowCreateModal(false)}
          onSubmit={handleCreateTask}
          labels={labelsData ?? []}
        />
      )}

      {showSettingsModal && project && workspace && (
        <ProjectSettingsModal
          project={{
            id: project.id,
            name: project.name,
            key: project.key,
            color: project.color,
            description: project.description,
            forgeRepositoryId: project.forgeRepositoryId ?? null,
            bobLaunchPolicy: project.bobLaunchPolicy ?? null,
            bobAwaitingInputTimeoutMinutes: project.bobAwaitingInputTimeoutMinutes ?? null,
          }}
          workspaceId={workspace.id}
          onClose={() => setShowSettingsModal(false)}
          onSubmit={async (data) => {
            await updateProjectMutation.mutateAsync({
              id: project.id,
              ...data,
            });
          }}
          onDelete={() => {
            deleteProjectMutation.mutate({ id: project.id });
          }}
        />
      )}
    </div>
  );
}
