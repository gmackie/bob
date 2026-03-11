"use client";

import { Avatar, AvatarFallback, AvatarImage } from "@linear-clone/ui/components/avatar";
import { Badge } from "@linear-clone/ui";
import { Bot } from "lucide-react";
import { cn } from "@linear-clone/ui/lib/utils";
import { StatusBadge, type TaskStatus } from "./status-badge";
import { PriorityIcon, type TaskPriority } from "./priority-badge";
import { BobTaskIndicators, type BobTaskProjection } from "./bob-task-indicators";

interface TaskRowProps {
  task: {
    id: string;
    identifier: string;
    title: string;
    status: TaskStatus;
    priority: TaskPriority;
    funnelArtifactType?: string | null;
    funnelStage?: string | null;
    updatedAt?: Date;
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
    bobView?: BobTaskProjection | null;
  };
  onClick?: () => void;
  selected?: boolean;
  className?: string;
  actions?: React.ReactNode;
  showStatusLabel?: boolean;
  showUpdatedAt?: boolean;
  showUpdatedBy?: boolean;
}

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

const getFunnelArtifactLabel = (value?: string | null): string | null => {
  if (!value) return null;
  return funnelArtifactLabels[value] ?? value.replace(/_/g, " ");
};

const getFunnelStageLabel = (value?: string | null): string | null => {
  if (!value) return null;
  return funnelStageLabels[value] ?? value.replace(/_/g, " ");
};

const getFunnelStageTone = (stage?: string | null) => {
  if (!stage) return "bg-muted text-muted-foreground";
  if (["production_deployed", "ready_for_execution", "picked_up"].includes(stage)) {
    return "bg-green-500/10 text-green-600 border-green-500/30";
  }
  if (["designed", "planned", "triaged"].includes(stage)) {
    return "bg-blue-500/10 text-blue-600 border-blue-500/30";
  }
  return "bg-slate-500/10 text-slate-600 border-slate-500/30";
};

export function TaskRow({
  task,
  onClick,
  selected,
  className,
  actions,
  showStatusLabel = false,
  showUpdatedAt = false,
  showUpdatedBy = false,
}: TaskRowProps) {
  const initials = task.assignee?.name
    ?.split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2) ?? "?";

  const isOverdue = task.dueDate && new Date(task.dueDate) < new Date() && task.status !== "done" && task.status !== "canceled";

  return (
    <div
      onClick={onClick}
      className={cn(
        "group flex items-center gap-3 border-b border-border px-4 py-2.5 transition-colors hover:bg-muted/50 cursor-pointer",
        selected && "bg-muted",
        className
      )}
    >
      <PriorityIcon priority={task.priority} className="shrink-0" />

      <span className="shrink-0 w-20 text-xs text-muted-foreground font-mono">
        {task.identifier}
      </span>

      <StatusBadge status={task.status} className="shrink-0" showLabel={showStatusLabel} />

      {task.assignee?.isAgent && (
        <Badge
          variant="outline"
          className={cn(
            "shrink-0 text-xs px-1.5 py-0 h-5",
            task.status === "in_progress"
              ? "bg-green-500/10 text-green-600 border-green-500/30"
              : "bg-purple-500/10 text-purple-600 border-purple-500/30"
          )}
        >
          <Bot className="h-3 w-3 mr-1" />
          AI
        </Badge>
      )}

      {getFunnelArtifactLabel(task.funnelArtifactType) && (
        <Badge
          variant="outline"
          className="shrink-0 hidden md:inline-flex text-xs px-2 py-0.5 h-5"
        >
          {getFunnelArtifactLabel(task.funnelArtifactType)}
        </Badge>
      )}

      {getFunnelStageLabel(task.funnelStage) && (
        <Badge
          variant="outline"
          className={cn(
            "shrink-0 hidden md:inline-flex text-xs px-2 py-0.5 h-5",
            getFunnelStageTone(task.funnelStage)
          )}
        >
          {getFunnelStageLabel(task.funnelStage)}
        </Badge>
      )}

      <span className="flex-1 truncate text-sm font-medium">
        {task.title}
      </span>

      <div className="hidden xl:flex shrink-0 max-w-[18rem]">
        <BobTaskIndicators bobView={task.bobView} onClick={onClick} />
      </div>

      {task.labels && task.labels.length > 0 && (
        <div className="hidden md:flex items-center gap-1 shrink-0">
          {task.labels.slice(0, 3).map((label) => (
            <span
              key={label.id}
              className="inline-flex items-center rounded-full px-2 py-0.5 text-xs"
              style={{ backgroundColor: `${label.color}20`, color: label.color }}
            >
              {label.name}
            </span>
          ))}
          {task.labels.length > 3 && (
            <span className="text-xs text-muted-foreground">+{task.labels.length - 3}</span>
          )}
        </div>
      )}

      {task.project && (
        <span
          className="hidden lg:inline-flex items-center gap-1.5 shrink-0 text-xs text-muted-foreground"
        >
          <span
            className="h-2 w-2 rounded-full"
            style={{ backgroundColor: task.project.color ?? "#6366f1" }}
          />
          {task.project.name}
        </span>
      )}

      {task.dueDate && (
        <span
          className={cn(
            "hidden sm:inline-flex shrink-0 text-xs",
            isOverdue ? "text-red-500" : "text-muted-foreground"
          )}
        >
          {new Date(task.dueDate).toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
          })}
        </span>
      )}

      {showUpdatedAt && task.updatedAt && (
        <span className="hidden md:inline-flex shrink-0 text-xs text-muted-foreground">
          {new Date(task.updatedAt).toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
          })}
        </span>
      )}

      {actions && (
        <div className="hidden group-hover:flex shrink-0">{actions}</div>
      )}

      <div className="flex items-center gap-2 shrink-0">
        {showUpdatedBy && task.assignee?.name && (
          <span className="hidden lg:inline-flex max-w-28 truncate text-xs text-muted-foreground">
            {task.assignee.name}
          </span>
        )}
        <Avatar className="h-6 w-6 shrink-0">
          {task.assignee?.avatarUrl ? (
            <AvatarImage src={task.assignee.avatarUrl} alt={task.assignee.name ?? ""} />
          ) : null}
          <AvatarFallback className="text-[10px]">
            {task.assignee ? initials : ""}
          </AvatarFallback>
        </Avatar>
      </div>
    </div>
  );
}
