"use client";

import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "next/navigation";

import { MissionControl } from "~/components/dashboard/mission-control";
import {
  getTaskDashboardHeaderModel,
  selectTaskDashboardWorkspace,
} from "~/components/tasks/task-shell-model";
import { useTRPC } from "~/trpc/react";

export default function TasksDashboardPage() {
  const trpc = useTRPC();
  const searchParams = useSearchParams();
  const { data: workspaceRows } = useQuery(
    trpc.workspace.list.queryOptions(undefined, { staleTime: 60_000 }),
  );
  const workspaceParam = searchParams?.get("workspace") ?? null;
  const currentWorkspace = selectTaskDashboardWorkspace(
    Array.isArray(workspaceRows) ? workspaceRows : [],
    workspaceParam,
  );
  const header = getTaskDashboardHeaderModel();

  return (
    <main className="mx-auto max-w-7xl px-6 py-10">
      <div className="mb-8">
        <h1 className="font-display text-4xl font-bold tracking-tight leading-[1.15] text-foreground">
          {header.title}
        </h1>
        {header.subtitle ? (
          <p className="mt-1 text-sm text-muted-foreground">{header.subtitle}</p>
        ) : null}
      </div>

      <MissionControl workspaceId={currentWorkspace?.id} />
    </main>
  );
}
