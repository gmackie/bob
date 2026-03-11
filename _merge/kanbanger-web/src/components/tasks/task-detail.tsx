"use client";

import { useState } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@linear-clone/ui/components/avatar";
import { Button } from "@linear-clone/ui/components/button";
import { Separator } from "@linear-clone/ui/components/separator";
import { cn } from "@linear-clone/ui/lib/utils";
import { StatusBadge, type TaskStatus, statusConfig } from "./status-badge";
import { PriorityBadge, type TaskPriority, priorityConfig } from "./priority-badge";
import {
  X,
  MoreHorizontal,
  Link as LinkIcon,
  Clock,
  Calendar,
  User,
  Tag,
  FolderKanban,
  ChevronDown,
  GitPullRequest,
  GitCommit,
  GitBranch,
  ExternalLink,
  Circle,
  XCircle,
  GitMerge,
  CornerDownRight,
} from "lucide-react";
import { SubTasks } from "./sub-tasks";
import { Dependencies } from "./dependencies";
import { Comments } from "./comments";
import { EstimatePicker } from "./estimate-picker";
import { CyclePicker } from "./cycle-picker";
import { BobPanel } from "./bob-panel";
import { BobRunHistory } from "./bob-run-history";
import { IssueArtifactList } from "./issue-artifact-list";
import type {
  BobRunSummary,
  ChildIssueArtifactGroup,
  IssueArtifactSummary,
} from "./task-detail-types";

interface GitLink {
  id: string;
  type: string;
  number?: number | null;
  title?: string | null;
  url: string;
  state?: string | null;
  author?: string | null;
  createdAt: Date;
}

interface Activity {
  id: string;
  type: string;
  fromValue?: string | null;
  toValue?: string | null;
  createdAt: Date;
  user?: {
    id: string;
    name: string | null;
    avatarUrl: string | null;
  } | null;
}

interface SubTask {
  id: string;
  identifier: string;
  title: string;
  status: TaskStatus;
  priority: TaskPriority;
  assignee?: {
    id: string;
    name: string | null;
    avatarUrl: string | null;
  } | null;
}

interface DependencyIssue {
  id: string;
  identifier: string;
  title: string;
  status: string;
  priority: string;
}

interface Dependency {
  id: string;
  issue: DependencyIssue;
}

interface CommentUser {
  id: string;
  name: string | null;
  avatarUrl: string | null;
}

interface CommentReaction {
  emoji: string;
  userId: string;
}

interface CommentReply {
  id: string;
  body: string;
  edited: boolean;
  createdAt: Date;
  user: CommentUser;
  reactions: CommentReaction[];
}

interface TaskComment {
  id: string;
  body: string;
  edited: boolean;
  createdAt: Date;
  user: CommentUser;
  reactions: CommentReaction[];
  replies: CommentReply[];
}

interface TaskDetailProps {
  task: {
    id: string;
    identifier: string;
    title: string;
    description?: string | null;
    status: TaskStatus;
    priority: TaskPriority;
    funnelArtifactType?: string | null;
    funnelStage?: string | null;
    creator?: {
      id: string;
      name: string | null;
      avatarUrl: string | null;
    } | null;
    assignee?: {
      id: string;
      name: string | null;
      avatarUrl: string | null;
    } | null;
    project?: {
      id: string;
      name: string;
      color: string | null;
    } | null;
    labels?: Array<{
      id: string;
      name: string;
      color: string;
    }>;
    dueDate?: Date | null;
    estimate?: number | null;
    cycleId?: string | null;
    createdAt: Date;
    updatedAt: Date;
    gitLinks?: GitLink[];
    activities?: Activity[];
    subIssuesCount?: number;
    bobRun?: BobRunSummary | null;
    bobRunHistory?: BobRunSummary[];
    currentArtifacts?: IssueArtifactSummary[];
    childArtifactGroups?: ChildIssueArtifactGroup[];
    parent?: {
      id: string;
      identifier: string;
      title: string;
      status: string;
    } | null;
  };
  subTasks?: SubTask[];
  subTasksLoading?: boolean;
  dependencies?: {
    blockedBy: Dependency[];
    blocking: Dependency[];
  };
  dependenciesLoading?: boolean;
  dependencySearchResults?: DependencyIssue[];
  isDependencySearching?: boolean;
  onClose?: () => void;
  onStatusChange?: (status: TaskStatus) => void;
  onPriorityChange?: (priority: TaskPriority) => void;
  onAssigneeChange?: (userId: string | null) => void;
  onTitleChange?: (title: string) => void;
  onDescriptionChange?: (description: string) => void;
  onCreateSubTask?: (title: string) => Promise<void>;
  onSubTaskStatusChange?: (subTaskId: string, status: TaskStatus) => void;
  onSubTaskClick?: (subTask: SubTask) => void;
  onParentClick?: (parentId: string) => void;
  onAddBlockedBy?: (issueId: string) => Promise<void>;
  onAddBlocking?: (issueId: string) => Promise<void>;
  onRemoveDependency?: (dependencyId: string) => Promise<void>;
  onDependencySearch?: (query: string) => void;
  onDependencyIssueClick?: (issueId: string) => void;
  comments?: TaskComment[];
  commentsLoading?: boolean;
  currentUser?: CommentUser;
  onSubmitComment?: (body: string, parentId?: string) => Promise<void>;
  onEditComment?: (commentId: string, body: string) => Promise<void>;
  onDeleteComment?: (commentId: string) => Promise<void>;
  onAddCommentReaction?: (commentId: string, emoji: string) => Promise<void>;
  onRemoveCommentReaction?: (commentId: string, emoji: string) => Promise<void>;
  onRequestDoc?: (docType: string) => Promise<void>;
  onEstimateChange?: (estimate: number | null) => void;
  cycles?: Array<{
    id: string;
    name: string | null;
    number: number;
    status: "upcoming" | "active" | "completed";
    startDate: Date;
    endDate: Date;
  }>;
  cyclesLoading?: boolean;
  onCycleChange?: (cycleId: string | null) => void;
  onBobPrimaryAction?: () => void;
  onContinueBobRun?: (runId: string) => void;
}

function ActivityItem({ activity }: { activity: Activity }) {
  const formatDate = (date: Date) =>
    new Date(date).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });

  const getActivityMessage = () => {
    const userName = activity.user?.name ?? "Someone";
    switch (activity.type) {
      case "created":
        return <><span className="font-medium text-foreground">{userName}</span> created this task</>;
      case "status_changed":
        return (
          <>
            <span className="font-medium text-foreground">{userName}</span> changed status from{" "}
            <span className="font-medium">{activity.fromValue?.replace("_", " ")}</span> to{" "}
            <span className="font-medium">{activity.toValue?.replace("_", " ")}</span>
          </>
        );
      case "priority_changed":
        return (
          <>
            <span className="font-medium text-foreground">{userName}</span> changed priority from{" "}
            <span className="font-medium">{activity.fromValue?.replace("_", " ")}</span> to{" "}
            <span className="font-medium">{activity.toValue?.replace("_", " ")}</span>
          </>
        );
      case "assignee_changed":
        if (!activity.fromValue && activity.toValue) {
          return <><span className="font-medium text-foreground">{userName}</span> assigned this task</>;
        }
        if (activity.fromValue && !activity.toValue) {
          return <><span className="font-medium text-foreground">{userName}</span> unassigned this task</>;
        }
        return <><span className="font-medium text-foreground">{userName}</span> changed the assignee</>;
      case "comment_added":
        return <><span className="font-medium text-foreground">{userName}</span> added a comment</>;
      case "linked_to_pr":
        return <><span className="font-medium text-foreground">{userName}</span> linked a pull request</>;
      case "linked_to_commit":
        return <><span className="font-medium text-foreground">{userName}</span> linked a commit</>;
      case "label_added":
        return <><span className="font-medium text-foreground">{userName}</span> added a label</>;
      case "label_removed":
        return <><span className="font-medium text-foreground">{userName}</span> removed a label</>;
      case "cycle_changed":
        return <><span className="font-medium text-foreground">{userName}</span> changed the cycle</>;
      case "due_date_changed":
        return <><span className="font-medium text-foreground">{userName}</span> updated the due date</>;
      case "estimate_changed":
        return <><span className="font-medium text-foreground">{userName}</span> updated the estimate</>;
      default:
        return <><span className="font-medium text-foreground">{userName}</span> updated the task</>;
    }
  };

  const getActivityIcon = () => {
    switch (activity.type) {
      case "status_changed":
        return <Circle className="h-4 w-4" />;
      case "priority_changed":
        return <Clock className="h-4 w-4" />;
      case "assignee_changed":
        return <User className="h-4 w-4" />;
      case "linked_to_pr":
        return <GitPullRequest className="h-4 w-4" />;
      case "linked_to_commit":
        return <GitCommit className="h-4 w-4" />;
      default:
        return <Clock className="h-4 w-4" />;
    }
  };

  return (
    <div className="flex gap-3 text-sm text-muted-foreground">
      <div className="mt-0.5">{getActivityIcon()}</div>
      <div className="flex-1">
        <div>{getActivityMessage()}</div>
        <div className="text-xs">{formatDate(activity.createdAt)}</div>
      </div>
    </div>
  );
}

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

const funnelArtifactLabels: Record<string, string> = {
  idea: "Idea",
  plan: "Plan",
  brd: "BRD",
  spec: "Spec",
  task: "Task",
  pr: "PR",
  release: "Release",
};

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

const docRequestOptions = [
  {
    type: "brd",
    label: "Request BRD",
    template: "Please generate/update the BRD for this initiative and include assumptions, risks, and acceptance criteria.",
  },
  {
    type: "detailed_requirements",
    label: "Request Detailed Requirements",
    template:
      "Please draft/update detailed requirements for this initiative, including edge cases and functional details.",
  },
  {
    type: "design_docs",
    label: "Request Design Docs",
    template: "Please create/update design docs for architecture and implementation approach for this initiative.",
  },
  {
    type: "tasks",
    label: "Request Task Breakdown",
    template: "Please break this initiative into implementation tasks with clear ownership and dependencies.",
  },
  {
    type: "team_paradigms",
    label: "Request Team Paradigms",
    template: "Please align this initiative with team paradigms and working agreements before execution.",
  },
];

const formatFunnelArtifact = (artifactType: string | null | undefined) =>
  artifactType ? (funnelArtifactLabels[artifactType] ?? artifactType.replace(/_/g, " ")) : "Unknown";

const formatFunnelStage = (stage: string | null | undefined) =>
  stage ? (funnelStageLabels[stage] ?? stage.replace(/_/g, " ")) : "Unstaged";

function GitLinkItem({ link }: { link: GitLink }) {
  const getIcon = () => {
    if (link.type === "pull_request") {
      if (link.state === "merged") return <GitMerge className="h-4 w-4 text-purple-500" />;
      if (link.state === "closed") return <XCircle className="h-4 w-4 text-red-500" />;
      return <GitPullRequest className="h-4 w-4 text-green-500" />;
    }
    if (link.type === "commit") return <GitCommit className="h-4 w-4 text-blue-500" />;
    if (link.type === "branch") return <GitBranch className="h-4 w-4 text-orange-500" />;
    return <Circle className="h-4 w-4 text-muted-foreground" />;
  };

  const getStateLabel = () => {
    if (link.type === "pull_request") {
      if (link.state === "merged") return "Merged";
      if (link.state === "closed") return "Closed";
      if (link.state === "open") return "Open";
    }
    return null;
  };

  const stateLabel = getStateLabel();

  return (
    <a
      href={link.url}
      target="_blank"
      rel="noopener noreferrer"
      className="group flex items-start gap-2 rounded-md p-2 hover:bg-muted"
    >
      <div className="mt-0.5">{getIcon()}</div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          {link.type === "pull_request" && link.number && (
            <span className="text-xs font-medium text-muted-foreground">#{link.number}</span>
          )}
          <span className="truncate text-sm font-medium">{link.title || link.url}</span>
          <ExternalLink className="h-3 w-3 flex-shrink-0 opacity-0 group-hover:opacity-50" />
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          {stateLabel && (
            <span
              className={cn(
                "rounded px-1.5 py-0.5 font-medium",
                link.state === "merged" && "bg-purple-500/10 text-purple-500",
                link.state === "closed" && "bg-red-500/10 text-red-500",
                link.state === "open" && "bg-green-500/10 text-green-500"
              )}
            >
              {stateLabel}
            </span>
          )}
          {link.author && <span>by {link.author}</span>}
          <span>
            {new Date(link.createdAt).toLocaleDateString("en-US", {
              month: "short",
              day: "numeric",
            })}
          </span>
        </div>
      </div>
    </a>
  );
}

export function TaskDetail({
  task,
  subTasks = [],
  subTasksLoading,
  dependencies,
  dependenciesLoading,
  dependencySearchResults,
  isDependencySearching,
  onClose,
  onStatusChange,
  onPriorityChange,
  onTitleChange,
  onDescriptionChange,
  onCreateSubTask,
  onSubTaskStatusChange,
  onSubTaskClick,
  onParentClick,
  onAddBlockedBy,
  onAddBlocking,
  onRemoveDependency,
  onDependencySearch,
  onDependencyIssueClick,
  comments = [],
  commentsLoading,
  currentUser,
  onSubmitComment,
  onEditComment,
  onDeleteComment,
  onAddCommentReaction,
  onRemoveCommentReaction,
  onEstimateChange,
  cycles = [],
  cyclesLoading,
  onCycleChange,
  onBobPrimaryAction,
  onContinueBobRun,
  onRequestDoc,
}: TaskDetailProps) {
  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description ?? "");
  const [showStatusPicker, setShowStatusPicker] = useState(false);
  const [showPriorityPicker, setShowPriorityPicker] = useState(false);
  const [isRequestingDoc, setIsRequestingDoc] = useState<string | null>(null);

  const normalizedStage = funnelStageOrder.find((stage) => stage === task.funnelStage);
  const stageIndex = normalizedStage ? funnelStageOrder.indexOf(normalizedStage) : -1;
  const currentStageLabel = formatFunnelStage(task.funnelStage);
  const currentArtifactLabel = formatFunnelArtifact(task.funnelArtifactType);
  const bobRunHistory = task.bobRunHistory ?? [];
  const directArtifacts = task.currentArtifacts ?? [];
  const childArtifactGroups = task.childArtifactGroups ?? [];
  const parentArtifactsTitle =
    childArtifactGroups.length > 0 ? "Parent artifacts" : "Artifacts";

  const handleRequestDoc = async (docType: string) => {
    setIsRequestingDoc(docType);
    try {
      await onRequestDoc?.(docType);
    } finally {
      setIsRequestingDoc(null);
    }
  };

  const handleTitleBlur = () => {
    if (title !== task.title) {
      onTitleChange?.(title);
    }
  };

  const handleDescriptionBlur = () => {
    if (description !== (task.description ?? "")) {
      onDescriptionChange?.(description);
    }
  };

  return (
    <div className="flex h-full flex-col bg-background">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="font-mono text-sm text-muted-foreground">
            {task.identifier}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon" className="h-8 w-8">
            <LinkIcon className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" className="h-8 w-8">
            <MoreHorizontal className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="flex min-h-full flex-col lg:flex-row">
          <div className="min-w-0 flex-1 p-4">
            {task.parent && (
              <button
                onClick={() => onParentClick?.(task.parent!.id)}
                className="mb-2 flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
              >
                <CornerDownRight className="h-3.5 w-3.5" />
                <span className="font-mono text-xs">{task.parent.identifier}</span>
                <span className="truncate">{task.parent.title}</span>
              </button>
            )}

            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onBlur={handleTitleBlur}
              className="w-full bg-transparent text-lg font-semibold outline-none placeholder:text-muted-foreground"
              placeholder="Task title"
            />

            <div className="mt-4 space-y-3">
              <div className="relative flex items-center gap-4">
                <span className="w-24 text-sm text-muted-foreground">Status</span>
                <button
                  onClick={() => setShowStatusPicker(!showStatusPicker)}
                  className="flex items-center gap-2 rounded-md px-2 py-1 hover:bg-muted"
                >
                  <StatusBadge status={task.status} showLabel />
                  <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                </button>
                {showStatusPicker && (
                  <div className="absolute left-28 top-full z-10 mt-1 w-48 rounded-md border border-border bg-popover p-1 shadow-md">
                    {Object.entries(statusConfig).map(([key, config]) => (
                      <button
                        key={key}
                        onClick={() => {
                          onStatusChange?.(key as TaskStatus);
                          setShowStatusPicker(false);
                        }}
                        className={cn(
                          "flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-muted",
                          task.status === key && "bg-muted"
                        )}
                      >
                        {config.icon}
                        <span>{config.label}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div className="relative flex items-center gap-4">
                <span className="w-24 text-sm text-muted-foreground">Priority</span>
                <button
                  onClick={() => setShowPriorityPicker(!showPriorityPicker)}
                  className="flex items-center gap-2 rounded-md px-2 py-1 hover:bg-muted"
                >
                  <PriorityBadge priority={task.priority} showLabel />
                  <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                </button>
                {showPriorityPicker && (
                  <div className="absolute left-28 top-full z-10 mt-1 w-48 rounded-md border border-border bg-popover p-1 shadow-md">
                    {Object.entries(priorityConfig).map(([key, config]) => (
                      <button
                        key={key}
                        onClick={() => {
                          onPriorityChange?.(key as TaskPriority);
                          setShowPriorityPicker(false);
                        }}
                        className={cn(
                          "flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-muted",
                          task.priority === key && "bg-muted"
                        )}
                      >
                        {config.icon}
                        <span>{config.label}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div className="flex items-center gap-4">
                <span className="w-24 text-sm text-muted-foreground">Assignee</span>
                <button className="flex items-center gap-2 rounded-md px-2 py-1 hover:bg-muted">
                  {task.assignee ? (
                    <>
                      <Avatar className="h-5 w-5">
                        <AvatarImage src={task.assignee.avatarUrl ?? ""} />
                        <AvatarFallback className="text-[10px]">
                          {task.assignee.name?.charAt(0) ?? "?"}
                        </AvatarFallback>
                      </Avatar>
                      <span className="text-sm">{task.assignee.name}</span>
                    </>
                  ) : (
                    <>
                      <User className="h-4 w-4 text-muted-foreground" />
                      <span className="text-sm text-muted-foreground">Unassigned</span>
                    </>
                  )}
                  <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                </button>
              </div>

              <div className="flex items-center gap-4">
                <span className="w-24 text-sm text-muted-foreground">Project</span>
                <button className="flex items-center gap-2 rounded-md px-2 py-1 hover:bg-muted">
                  {task.project ? (
                    <>
                      <span
                        className="h-3 w-3 rounded"
                        style={{ backgroundColor: task.project.color ?? "#6366f1" }}
                      />
                      <span className="text-sm">{task.project.name}</span>
                    </>
                  ) : (
                    <>
                      <FolderKanban className="h-4 w-4 text-muted-foreground" />
                      <span className="text-sm text-muted-foreground">No project</span>
                    </>
                  )}
                  <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                </button>
              </div>

              <div className="flex items-center gap-4">
                <span className="w-24 text-sm text-muted-foreground">Labels</span>
                <div className="flex flex-wrap items-center gap-1">
                  {task.labels?.map((label) => (
                    <span
                      key={label.id}
                      className="inline-flex items-center rounded-full px-2 py-0.5 text-xs"
                      style={{ backgroundColor: `${label.color}20`, color: label.color }}
                    >
                      {label.name}
                    </span>
                  ))}
                  <button className="flex items-center gap-1 rounded-md px-2 py-0.5 text-xs text-muted-foreground hover:bg-muted">
                    <Tag className="h-3 w-3" />
                    Add label
                  </button>
                </div>
              </div>

              <div className="flex items-center gap-4">
                <span className="w-24 text-sm text-muted-foreground">Due date</span>
                <button className="flex items-center gap-2 rounded-md px-2 py-1 hover:bg-muted">
                  <Calendar className="h-4 w-4 text-muted-foreground" />
                  <span className={cn("text-sm", task.dueDate ? "" : "text-muted-foreground")}>
                    {task.dueDate
                      ? new Date(task.dueDate).toLocaleDateString("en-US", {
                          month: "short",
                          day: "numeric",
                          year: "numeric",
                        })
                      : "Set due date"}
                  </span>
                </button>
              </div>

              <div className="flex items-center gap-4">
                <span className="w-24 text-sm text-muted-foreground">Estimate</span>
                <EstimatePicker value={task.estimate} onChange={onEstimateChange} />
              </div>

              <div className="flex items-center gap-4">
                <span className="w-24 text-sm text-muted-foreground">Cycle</span>
                <CyclePicker
                  value={task.cycleId}
                  cycles={cycles}
                  isLoading={cyclesLoading}
                  onChange={onCycleChange}
                />
              </div>

              <Separator className="my-4" />

              <div>
                <h4 className="mb-3 text-sm font-medium">Funnel context</h4>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div className="rounded-md border bg-muted/20 px-3 py-2">
                    <p className="text-xs text-muted-foreground">Artifact</p>
                    <p className="font-medium">{currentArtifactLabel}</p>
                  </div>
                  <div className="rounded-md border bg-muted/20 px-3 py-2">
                    <p className="text-xs text-muted-foreground">Current Stage</p>
                    <p className="font-medium">{currentStageLabel}</p>
                  </div>
                </div>

                <div className="mt-3 rounded-md border p-3">
                  <p className="mb-2 text-xs text-muted-foreground">Funnel progress</p>
                  <div className="flex flex-wrap gap-1">
                    {funnelStageOrder.map((stage, idx) => {
                      const isCurrent = idx === stageIndex;
                      const isComplete = idx < stageIndex && stageIndex >= 0;
                      return (
                        <span
                          key={stage}
                          className={cn(
                            "inline-flex items-center rounded-full border px-2 py-1 text-xs",
                            isCurrent
                              ? "border-primary/30 bg-primary/10 text-primary"
                              : isComplete
                                ? "border-green-500/30 bg-green-500/10 text-green-600"
                                : "bg-muted text-muted-foreground"
                          )}
                        >
                          {funnelStageLabels[stage]}
                        </span>
                      );
                    })}
                  </div>
                </div>
              </div>

              {onRequestDoc && (
                <>
                  <Separator className="my-4" />
                  <div>
                    <h4 className="mb-2 text-sm font-medium">Request additional docs</h4>
                    <div className="flex flex-wrap gap-2">
                      {docRequestOptions.map((option) => (
                        <Button
                          key={option.type}
                          size="sm"
                          variant="outline"
                          onClick={() => handleRequestDoc(option.type)}
                          disabled={isRequestingDoc === option.type}
                        >
                          {isRequestingDoc === option.type ? "Sending..." : option.label}
                        </Button>
                      ))}
                    </div>
                  </div>
                </>
              )}
            </div>

            {!task.parent && (
              <>
                <Separator className="my-4" />
                <SubTasks
                  parentId={task.id}
                  subTasks={subTasks}
                  isLoading={subTasksLoading}
                  onSubTaskClick={onSubTaskClick}
                  onCreateSubTask={onCreateSubTask}
                  onStatusChange={onSubTaskStatusChange}
                />
              </>
            )}

            <Separator className="my-4" />

            <Dependencies
              blockedBy={dependencies?.blockedBy ?? []}
              blocking={dependencies?.blocking ?? []}
              isLoading={dependenciesLoading}
              searchResults={dependencySearchResults}
              isSearching={isDependencySearching}
              onAddBlockedBy={onAddBlockedBy}
              onAddBlocking={onAddBlocking}
              onRemove={onRemoveDependency}
              onSearch={onDependencySearch}
              onIssueClick={onDependencyIssueClick}
            />

            <Separator className="my-4" />

            <div>
              <h4 className="mb-2 text-sm font-medium">Description</h4>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                onBlur={handleDescriptionBlur}
                placeholder="Add a description..."
                className="min-h-[100px] w-full resize-none rounded-md bg-muted/50 p-3 text-sm outline-none placeholder:text-muted-foreground focus:ring-1 focus:ring-primary"
              />
            </div>

            {task.gitLinks && task.gitLinks.length > 0 && (
              <>
                <Separator className="my-4" />
                <div>
                  <h4 className="mb-3 text-sm font-medium">Development</h4>
                  <div className="space-y-2">
                    {task.gitLinks.map((link) => (
                      <GitLinkItem key={link.id} link={link} />
                    ))}
                  </div>
                </div>
              </>
            )}

            <Separator className="my-4" />

            <Comments
              comments={comments}
              isLoading={commentsLoading}
              currentUser={currentUser}
              onSubmit={onSubmitComment}
              onEdit={onEditComment}
              onDelete={onDeleteComment}
              onAddReaction={onAddCommentReaction}
              onRemoveReaction={onRemoveCommentReaction}
            />

            {task.activities && task.activities.length > 0 && (
              <>
                <Separator className="my-4" />
                <div>
                  <h4 className="mb-4 text-sm font-medium">Activity</h4>
                  <div className="space-y-3">
                    {task.activities.map((activity) => (
                      <ActivityItem key={activity.id} activity={activity} />
                    ))}
                  </div>
                </div>
              </>
            )}
          </div>

          <aside className="shrink-0 border-t border-border/70 bg-muted/10 p-4 lg:w-80 lg:border-l lg:border-t-0">
            <div className="space-y-4">
              <BobPanel
                activeRun={task.bobRun ?? null}
                hasHistory={bobRunHistory.length > 0}
                artifacts={directArtifacts.slice(0, 4)}
                onPrimaryAction={onBobPrimaryAction}
              />
              {directArtifacts.length > 0 ? (
                <IssueArtifactList title={parentArtifactsTitle} artifacts={directArtifacts} />
              ) : null}
              {childArtifactGroups.length > 0 ? (
                <IssueArtifactList title="Child artifacts" childGroups={childArtifactGroups} />
              ) : null}
              <BobRunHistory runs={bobRunHistory} onContinueRun={onContinueBobRun} />
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}
