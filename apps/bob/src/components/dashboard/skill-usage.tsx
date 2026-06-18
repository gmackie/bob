"use client";

import { useQuery } from "@tanstack/react-query";
import { cn } from "@gmacko/core/ui";
import { useTRPC } from "~/trpc/react";

interface SkillStat {
  name: string;
  slug: string;
  count: number;
  successCount: number;
  totalDurationMs: number;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remaining = seconds % 60;
  return remaining > 0 ? `${minutes}m ${remaining}s` : `${minutes}m`;
}

function formatRate(success: number, total: number): string {
  if (total === 0) return "--";
  return `${Math.round((success / total) * 100)}%`;
}

export function SkillUsage() {
  const trpc = useTRPC();

  const { data: statsData } = useQuery({
    ...trpc.skill.stats.queryOptions(),
    staleTime: 30_000,
  });

  const { data: skills } = useQuery({
    ...trpc.skill.list.queryOptions({}),
    staleTime: 60_000,
  });

  const statsMap = new Map(
    (statsData ?? []).map((s: any) => [s.slug, s]),
  );

  const stats: SkillStat[] = (skills ?? []).map((skill) => {
    const s = statsMap.get(skill.slug);
    return {
      name: skill.name,
      slug: skill.slug,
      count: s?.count ?? 0,
      successCount: s?.successCount ?? 0,
      totalDurationMs: s?.totalDurationMs ?? 0,
    };
  });

  stats.sort((a, b) => b.count - a.count);

  const maxCount = Math.max(1, ...stats.map((s) => s.count));

  return (
    <div className="rounded-2xl border border-border bg-card p-5">
      <h3 className="font-display text-sm font-semibold text-foreground">
        Skill Usage
      </h3>

      {!skills ? (
        <div className="mt-3 space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-4 animate-pulse rounded bg-muted/50" />
          ))}
        </div>
      ) : stats.length === 0 ? (
        <p className="mt-3 font-body text-sm text-muted-foreground">
          No skills registered yet
        </p>
      ) : (
        <div className="mt-3 space-y-2.5">
          {stats.map((stat) => (
            <div key={stat.slug} className="space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-sm text-foreground font-medium">
                  /{stat.slug}
                </span>
                <div className="flex items-center gap-3 text-xs text-muted-foreground tabular-nums">
                  <span>{stat.count} runs</span>
                  <span
                    className={cn(
                      stat.count > 0 &&
                        stat.successCount / stat.count >= 0.9
                        ? "text-emerald-600 dark:text-emerald-400"
                        : stat.count > 0 &&
                            stat.successCount / stat.count < 0.5
                          ? "text-rose-600 dark:text-rose-400"
                          : "",
                    )}
                  >
                    {formatRate(stat.successCount, stat.count)}
                  </span>
                  <span>
                    {stat.count > 0
                      ? formatDuration(
                          Math.round(stat.totalDurationMs / stat.count),
                        )
                      : "--"}
                  </span>
                </div>
              </div>
              {/* Usage bar */}
              <div className="h-1.5 w-full rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-primary transition-all duration-300"
                  style={{
                    width: `${(stat.count / maxCount) * 100}%`,
                  }}
                />
              </div>
            </div>
          ))}

          {/* Legend */}
          <div className="flex items-center gap-4 pt-2 border-t border-border text-[10px] text-muted-foreground">
            <span>Runs</span>
            <span>Success %</span>
            <span>Avg Duration</span>
          </div>
        </div>
      )}
    </div>
  );
}
