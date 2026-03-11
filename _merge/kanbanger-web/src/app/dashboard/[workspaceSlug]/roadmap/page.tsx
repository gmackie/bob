"use client";

import { useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { api } from "@/lib/trpc/client";
import { Button } from "@linear-clone/ui/components/button";
import { cn } from "@linear-clone/ui/lib/utils";
import {
  ChevronLeft,
  ChevronRight,
  Map,
  FolderKanban,
} from "lucide-react";

interface Project {
  id: string;
  name: string;
  color: string | null;
  status: string;
  startDate: Date | null;
  targetDate: Date | null;
  progress: number;
}

function getMonthsBetween(start: Date, end: Date): Date[] {
  const months: Date[] = [];
  const current = new Date(start.getFullYear(), start.getMonth(), 1);

  while (current <= end) {
    months.push(new Date(current));
    current.setMonth(current.getMonth() + 1);
  }

  return months;
}

function getWeeksBetween(start: Date, end: Date): Date[] {
  const weeks: Date[] = [];
  const current = new Date(start);
  current.setDate(current.getDate() - current.getDay());

  while (current <= end) {
    weeks.push(new Date(current));
    current.setDate(current.getDate() + 7);
  }

  return weeks;
}

function formatMonth(date: Date): string {
  return date.toLocaleDateString("en-US", { month: "short", year: "numeric" });
}

function formatWeek(date: Date): string {
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function getDaysBetween(start: Date, end: Date): number {
  return Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
}

function ProjectBar({
  project,
  timelineStart,
  dayWidth,
  onClick,
}: {
  project: Project;
  timelineStart: Date;
  timelineEnd?: Date;
  dayWidth: number;
  onClick: () => void;
}) {
  if (!project.startDate || !project.targetDate) return null;

  const projectStart = new Date(project.startDate);
  const projectEnd = new Date(project.targetDate);

  const startOffset = Math.max(0, getDaysBetween(timelineStart, projectStart));
  const duration = getDaysBetween(projectStart, projectEnd);
  const adjustedDuration = Math.max(14, duration);

  const left = startOffset * dayWidth;
  const width = adjustedDuration * dayWidth;

  const today = new Date();
  const _isPast = projectEnd < today;
  const _isActive = projectStart <= today && projectEnd >= today;

  return (
    <button
      type="button"
      onClick={onClick}
      className="absolute top-1/2 -translate-y-1/2 h-8 rounded-md shadow-sm transition-all hover:shadow-md hover:z-10"
      style={{
        left: `${left}px`,
        width: `${Math.max(width, 80)}px`,
        backgroundColor: project.color ?? "#6366f1",
      }}
    >
      <div className="flex h-full items-center justify-between px-2 text-white">
        <span className="truncate text-xs font-medium">{project.name}</span>
        {project.progress > 0 && (
          <span className="shrink-0 text-[10px] opacity-80">
            {project.progress}%
          </span>
        )}
      </div>
      <div
        className="absolute bottom-0 left-0 h-1 rounded-b-md bg-white/30"
        style={{ width: `${project.progress}%` }}
      />
    </button>
  );
}

export default function RoadmapPage() {
  const params = useParams();
  const router = useRouter();
  const workspaceSlug = params.workspaceSlug as string;

  const [timeOffset, setTimeOffset] = useState(0);
  const [zoom, setZoom] = useState<"month" | "week">("month");

  const { data: workspace } = api.workspace.get.useQuery(
    { slug: workspaceSlug },
    { enabled: !!workspaceSlug }
  );

  const { data: projectsData, isLoading } = api.project.list.useQuery(
    { workspaceId: workspace?.id ?? "" },
    { enabled: !!workspace?.id }
  );

  const projects = useMemo(() => {
    if (!projectsData) return [];
    return projectsData
      .map((p) => ({
        id: p.project.id,
        name: p.project.name,
        color: p.project.color,
        status: p.project.status ?? "planned",
        startDate: p.project.startDate,
        targetDate: p.project.targetDate,
        progress: p.completedCount && p.issueCount
          ? Math.round((p.completedCount / p.issueCount) * 100)
          : 0,
      }))
      .filter((p) => p.startDate || p.targetDate)
      .sort((a, b) => {
        const aDate = a.startDate ?? a.targetDate;
        const bDate = b.startDate ?? b.targetDate;
        if (!aDate || !bDate) return 0;
        return new Date(aDate).getTime() - new Date(bDate).getTime();
      });
  }, [projectsData]);

  const { timelineStart, timelineEnd, periods, dayWidth } = useMemo(() => {
    const now = new Date();
    const baseStart = new Date(now.getFullYear(), now.getMonth() + timeOffset, 1);
    const monthsToShow = zoom === "month" ? 6 : 3;
    const baseEnd = new Date(baseStart);
    baseEnd.setMonth(baseEnd.getMonth() + monthsToShow);

    const periods =
      zoom === "month"
        ? getMonthsBetween(baseStart, baseEnd)
        : getWeeksBetween(baseStart, baseEnd);

    const totalDays = getDaysBetween(baseStart, baseEnd);
    const containerWidth = 800;
    const dayWidth = containerWidth / totalDays;

    return {
      timelineStart: baseStart,
      timelineEnd: baseEnd,
      periods,
      dayWidth,
    };
  }, [timeOffset, zoom]);

  const handleProjectClick = (projectId: string) => {
    router.push(`/dashboard/${workspaceSlug}/projects/${projectId}`);
  };

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-border px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10">
              <Map className="h-5 w-5 text-primary" />
            </div>
            <div>
              <h1 className="text-xl font-semibold">Roadmap</h1>
              <p className="text-sm text-muted-foreground">
                Timeline view of projects
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div className="flex items-center rounded-lg border border-border">
              <button
                type="button"
                onClick={() => setZoom("week")}
                className={cn(
                  "px-3 py-1.5 text-xs font-medium transition-colors",
                  zoom === "week"
                    ? "bg-muted text-foreground"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                Week
              </button>
              <button
                type="button"
                onClick={() => setZoom("month")}
                className={cn(
                  "px-3 py-1.5 text-xs font-medium transition-colors",
                  zoom === "month"
                    ? "bg-muted text-foreground"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                Month
              </button>
            </div>

            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={() => setTimeOffset((t) => t - 1)}
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setTimeOffset(0)}
              >
                Today
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={() => setTimeOffset((t) => t + 1)}
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-auto">
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
          </div>
        ) : projects.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
              <FolderKanban className="h-6 w-6 text-muted-foreground" />
            </div>
            <h3 className="mt-4 font-medium">No projects with dates</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Add start and target dates to your projects to see them on the roadmap.
            </p>
          </div>
        ) : (
          <div className="min-w-max p-6">
            <div className="flex border-b border-border">
              <div className="w-48 shrink-0 border-r border-border px-4 py-2">
                <span className="text-sm font-medium text-muted-foreground">
                  Project
                </span>
              </div>
              <div className="flex flex-1">
                {periods.map((period, i) => (
                  <div
                    key={i}
                    className="border-r border-border px-2 py-2 text-center"
                    style={{
                      width:
                        zoom === "month"
                          ? `${getDaysBetween(period, i < periods.length - 1 ? periods[i + 1]! : timelineEnd) * dayWidth}px`
                          : `${7 * dayWidth}px`,
                    }}
                  >
                    <span className="text-xs font-medium text-muted-foreground">
                      {zoom === "month" ? formatMonth(period) : formatWeek(period)}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {projects.map((project) => (
              <div key={project.id} className="flex border-b border-border">
                <div className="w-48 shrink-0 border-r border-border px-4 py-3">
                  <div className="flex items-center gap-2">
                    <span
                      className="h-2.5 w-2.5 shrink-0 rounded-sm"
                      style={{ backgroundColor: project.color ?? "#6366f1" }}
                    />
                    <span className="truncate text-sm font-medium">
                      {project.name}
                    </span>
                  </div>
                </div>
                <div
                  className="relative flex-1 py-2"
                  style={{
                    width: `${getDaysBetween(timelineStart, timelineEnd) * dayWidth}px`,
                  }}
                >
                  <ProjectBar
                    project={project}
                    timelineStart={timelineStart}
                    timelineEnd={timelineEnd}
                    dayWidth={dayWidth}
                    onClick={() => handleProjectClick(project.id)}
                  />
                </div>
              </div>
            ))}

            <div className="relative mt-4">
              <div
                className="absolute top-0 h-full w-px bg-red-500"
                style={{
                  left: `${48 * 4 + getDaysBetween(timelineStart, new Date()) * dayWidth}px`,
                }}
              />
              <div
                className="absolute -top-3 rounded bg-red-500 px-1.5 py-0.5 text-[10px] font-medium text-white"
                style={{
                  left: `${48 * 4 + getDaysBetween(timelineStart, new Date()) * dayWidth - 20}px`,
                }}
              >
                Today
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
