"use client";

import { cn } from "@linear-clone/ui/lib/utils";
import { Progress } from "@linear-clone/ui/components/progress";
import { FolderKanban, Users } from "lucide-react";

interface ProjectCardProps {
  project: {
    id: string;
    name: string;
    description?: string | null;
    color?: string | null;
    status: string;
    issueCount?: number;
    completedCount?: number;
    leadUser?: {
      id: string;
      name: string | null;
      avatarUrl: string | null;
    } | null;
    teams?: Array<{
      id: string;
      name: string;
      key: string;
    }>;
  };
  onClick?: () => void;
}

export function ProjectCard({ project, onClick }: ProjectCardProps) {
  const progress = project.issueCount
    ? Math.round(((project.completedCount ?? 0) / project.issueCount) * 100)
    : 0;

  const statusColors: Record<string, string> = {
    planned: "bg-gray-500",
    in_progress: "bg-blue-500",
    paused: "bg-yellow-500",
    completed: "bg-green-500",
    canceled: "bg-red-500",
  };

  const statusLabels: Record<string, string> = {
    planned: "Planned",
    in_progress: "In Progress",
    paused: "Paused",
    completed: "Completed",
    canceled: "Canceled",
  };

  return (
    <div
      onClick={onClick}
      className={cn(
        "cursor-pointer rounded-lg border border-border p-4 transition-colors hover:bg-muted/50"
      )}
    >
      <div className="flex items-start gap-3">
        {/* Project icon */}
        <div
          className="flex h-10 w-10 items-center justify-center rounded-lg"
          style={{ backgroundColor: `${project.color ?? "#6366f1"}20` }}
        >
          <FolderKanban
            className="h-5 w-5"
            style={{ color: project.color ?? "#6366f1" }}
          />
        </div>

        {/* Project info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="font-medium truncate">{project.name}</h3>
            <span
              className={cn(
                "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium text-white",
                statusColors[project.status] ?? "bg-gray-500"
              )}
            >
              {statusLabels[project.status] ?? project.status}
            </span>
          </div>
          {project.description && (
            <p className="mt-1 text-sm text-muted-foreground line-clamp-2">
              {project.description}
            </p>
          )}
        </div>
      </div>

      <div className="mt-4 space-y-3">
        {/* Progress */}
        {project.issueCount !== undefined && project.issueCount > 0 && (
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">Progress</span>
              <span>
                {project.completedCount ?? 0} / {project.issueCount} issues
              </span>
            </div>
            <Progress value={progress} className="h-1.5" />
          </div>
        )}

        {/* Footer */}
        <div className="flex items-center justify-between">
          {/* Teams */}
          {project.teams && project.teams.length > 0 && (
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              <Users className="h-3.5 w-3.5" />
              <span>{project.teams.map((t) => t.name).join(", ")}</span>
            </div>
          )}

          {/* Lead */}
          {project.leadUser && (
            <div className="flex items-center gap-1">
              <div className="flex h-5 w-5 items-center justify-center rounded-full bg-primary text-[10px] font-medium text-primary-foreground">
                {project.leadUser.name?.charAt(0) ?? "?"}
              </div>
              <span className="text-xs text-muted-foreground">
                {project.leadUser.name}
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
