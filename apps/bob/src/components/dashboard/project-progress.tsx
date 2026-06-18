"use client";

import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useTRPC } from "~/trpc/react";

const RING_SIZE = 40;
const STROKE_WIDTH = 3;
const RADIUS = (RING_SIZE - STROKE_WIDTH) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

function ProgressRing({
  completed,
  total,
  color,
}: {
  completed: number;
  total: number;
  color: string;
}) {
  const pct = total > 0 ? completed / total : 0;
  const offset = CIRCUMFERENCE * (1 - pct);

  return (
    <svg
      width={RING_SIZE}
      height={RING_SIZE}
      className="shrink-0 -rotate-90"
    >
      {/* Background ring */}
      <circle
        cx={RING_SIZE / 2}
        cy={RING_SIZE / 2}
        r={RADIUS}
        fill="none"
        stroke="currentColor"
        strokeWidth={STROKE_WIDTH}
        className="text-muted/50"
      />
      {/* Progress ring */}
      <circle
        cx={RING_SIZE / 2}
        cy={RING_SIZE / 2}
        r={RADIUS}
        fill="none"
        stroke={color}
        strokeWidth={STROKE_WIDTH}
        strokeLinecap="round"
        strokeDasharray={CIRCUMFERENCE}
        strokeDashoffset={offset}
        className="transition-[stroke-dashoffset] duration-500 ease-out"
      />
    </svg>
  );
}

/** Fallback color from project color field or a default. */
function ringColor(projectColor?: string | null): string {
  if (projectColor) return projectColor;
  return "var(--color-primary)";
}

interface ProjectProgressProps {
  workspaceId: string;
}

export function ProjectProgress({ workspaceId }: ProjectProgressProps) {
  const trpc = useTRPC();
  const router = useRouter();

  const { data: projectData, isLoading } = useQuery({
    ...trpc.planning.listProjects.queryOptions({ workspaceId }),
    staleTime: 30_000,
    enabled: !!workspaceId,
  });

  return (
    <div className="rounded-2xl border border-border bg-card p-5">
      <h3 className="font-display text-sm font-semibold text-foreground">
        Projects
      </h3>

      {isLoading ? (
        <div className="mt-3 space-y-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-10 animate-pulse rounded bg-muted/50" />
          ))}
        </div>
      ) : !projectData || projectData.length === 0 ? (
        <p className="mt-3 font-body text-sm text-muted-foreground">
          No projects
        </p>
      ) : (
        <div className="mt-3 space-y-3">
          {projectData.map((entry) => {
            const { project, issueCount, completedCount } = entry;

            return (
              <button
                key={project.id}
                type="button"
                onClick={() => router.push(`/projects/${project.id}`)}
                className="flex w-full items-center gap-3 rounded-lg p-1.5 text-left transition hover:bg-muted/40"
              >
                <ProgressRing
                  completed={completedCount}
                  total={issueCount}
                  color={ringColor(project.color)}
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-foreground">
                    {project.name}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {completedCount}/{issueCount} done
                  </p>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
