"use client";

import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "next/navigation";

import { Badge } from "@gmacko/core/ui/badge";
import Link from "next/link";

import { useTRPC } from "~/trpc/react";
import {
  buildPlanningDashboardSessionRows,
  buildPlanningDashboardSummaryCards,
  buildPlanningSessionGroups,
  filterPlanningDashboardSessions,
  getPlanningDashboardSections,
  getPlanningDashboardRecentSessionsHeader,
  normalizePlanningDashboardFilter,
  type PlanningDashboardSummaryTone,
  type PlanningDashboardSession,
  type PlanningProjectOption,
} from "./planning-dashboard-model";
import { getPlanningProjectQueryRefreshOptions } from "./planning-shell-model";
import { RecentPlans } from "./recent-plans";

interface PlanningDashboardProps {
  workspaceId?: string;
}

const SESSION_BADGE_VARIANT: Record<PlanningDashboardSummaryTone, "default" | "slate" | "blue" | "amber" | "emerald" | "rose"> = {
  default: "slate",
  warning: "amber",
  danger: "rose",
  success: "emerald",
};

const SUMMARY_TONE_CLASS: Record<PlanningDashboardSummaryTone, string> = {
  default: "text-muted-foreground bg-muted",
  warning: "text-amber-500 bg-amber-500/10",
  danger: "text-rose-500 bg-rose-500/10",
  success: "text-emerald-500 bg-emerald-500/10",
};

function ActivePlanningSessionsRail({
  sessions,
  workspaceId,
}: {
  sessions: PlanningDashboardSession[];
  workspaceId?: string | null;
}) {
  const rows = buildPlanningDashboardSessionRows(sessions, { workspaceId });

  return (
    <aside className="rounded-2xl border border-border bg-card p-5">
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-display text-sm font-semibold text-foreground">
          Active Sessions
        </h2>
        <span className="text-xs font-semibold tabular-nums text-muted-foreground">
          {sessions.length}
        </span>
      </div>

      {sessions.length === 0 ? (
        <p className="mt-4 text-sm text-muted-foreground">
          No planning sessions are currently running.
        </p>
      ) : (
        <div className="mt-4 flex flex-col gap-2">
          {rows.map((session) => (
            <Link
              key={session.id}
              href={session.href}
              className="rounded-lg border border-border/70 bg-background/40 px-3 py-2.5 text-left transition-colors hover:bg-muted/30"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-foreground">
                    {session.title}
                  </p>
                  <p className="mt-1 truncate text-xs text-muted-foreground">
                    {session.projectLabel} · {session.outputLabel} · {session.lastUpdatedLabel}
                  </p>
                </div>
                <Badge
                  variant={SESSION_BADGE_VARIANT[session.statusTone]}
                  className="shrink-0 text-[10px]"
                >
                  {session.statusLabel}
                </Badge>
              </div>
            </Link>
          ))}
        </div>
      )}
    </aside>
  );
}

export function PlanningDashboard({ workspaceId }: PlanningDashboardProps) {
  const trpc = useTRPC();
  const searchParams = useSearchParams();
  const sessionFilter = normalizePlanningDashboardFilter(searchParams?.get("filter"));
  const { data: sessions, isLoading } = useQuery(
    trpc.planSession.list.queryOptions(
      { workspaceId, limit: 20 },
      { refetchInterval: 10_000 },
    ),
  );
  const { data: projects } = useQuery(
    trpc.planning.listProjects.queryOptions(
      { workspaceId: workspaceId ?? "" },
      {
        enabled: Boolean(workspaceId),
        ...getPlanningProjectQueryRefreshOptions(),
      },
    ),
  );

  const groups = buildPlanningSessionGroups((sessions ?? []) as PlanningDashboardSession[]);
  const projectOptions = (projects ?? []) as unknown as PlanningProjectOption[];
  const summaryCards = buildPlanningDashboardSummaryCards({
    workspaceId,
    sessions: (sessions ?? []) as PlanningDashboardSession[],
    projects: projectOptions,
  });
  const visibleRecentSessions = sessionFilter
    ? filterPlanningDashboardSessions((sessions ?? []) as PlanningDashboardSession[], sessionFilter)
    : groups.recent;
  const recentSessionsHeader = getPlanningDashboardRecentSessionsHeader(sessionFilter);
  const sections = getPlanningDashboardSections();

  return (
    <div className="grid gap-5 xl:grid-cols-[1fr_22rem]">
      <div className="min-w-0 space-y-5">
        {sections.includes("summary-cards") ? (
          <section className="grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
            {summaryCards.map((card) => (
              <Link
                key={card.key}
                href={card.href}
                className="rounded-lg border border-border bg-card px-3 py-3 transition-colors hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
              >
                <div className="flex items-center justify-between gap-2">
                  <h3 className="min-w-0 truncate text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    {card.title}
                  </h3>
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums ${SUMMARY_TONE_CLASS[card.tone]}`}
                  >
                    {card.count}
                  </span>
                </div>
              </Link>
            ))}
          </section>
        ) : null}

        {sections.includes("recent-sessions") ? (
          <section className="rounded-2xl border border-border bg-card p-5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="font-display text-base font-semibold text-foreground">
                  {recentSessionsHeader.title}
                </h2>
                {recentSessionsHeader.subtitle ? (
                  <p className="mt-1 text-sm text-muted-foreground">
                    {recentSessionsHeader.subtitle}
                  </p>
                ) : null}
              </div>
              <div className="flex shrink-0 items-center gap-3">
                {isLoading ? (
                  <span className="text-xs text-muted-foreground">Loading</span>
                ) : (
                  <span className="text-xs font-semibold tabular-nums text-muted-foreground">
                    {visibleRecentSessions.length}
                  </span>
                )}
              </div>
            </div>
            <div className="mt-4">
              <RecentPlans
                sessions={visibleRecentSessions}
                isLoading={isLoading}
                workspaceId={workspaceId}
              />
            </div>
          </section>
        ) : null}
      </div>

      {sections.includes("active-sessions-rail") ? (
        <ActivePlanningSessionsRail sessions={groups.active} workspaceId={workspaceId} />
      ) : null}
    </div>
  );
}
