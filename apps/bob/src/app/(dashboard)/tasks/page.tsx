"use client";

import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "next/navigation";

import { MissionControl } from "~/components/dashboard/mission-control";
import { getTaskDashboardHeaderModel } from "~/components/tasks/task-shell-model";
import { useTRPC } from "~/trpc/react";

type WorkspaceMembership = {
  workspace?: { id: string; name?: string | null } | null;
};

export default function TasksDashboardPage() {
  const trpc = useTRPC();
  const searchParams = useSearchParams();
  const { data: workspaceMemberships } = useQuery(
    trpc.workspace.list.queryOptions(undefined, { staleTime: 60_000 }),
  );

  const memberships = (workspaceMemberships ?? []) as unknown as WorkspaceMembership[];
  const workspaces = memberships.flatMap((membership) =>
    membership.workspace ? [membership.workspace] : [],
  );
  const workspaceParam = searchParams?.get("workspace") ?? null;
  const currentWorkspace =
    (workspaceParam
      ? workspaces.find((workspace) => workspace.id === workspaceParam)
      : workspaces[0]) ?? null;
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
