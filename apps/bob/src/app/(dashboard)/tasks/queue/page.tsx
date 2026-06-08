"use client";

import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "next/navigation";

import { WorkLaneTable } from "~/components/dashboard/work-lane-table";
import type { WorkLaneKey } from "~/components/dashboard/work-pipeline-model";
import { PriorityQueueTable } from "~/components/tasks/priority-queue-table";
import { useTRPC } from "~/trpc/react";

type WorkspaceMembership = {
  workspace?: { id: string; name?: string | null } | null;
};

const WORK_LANE_KEYS = new Set(["needs-attention", "ready", "active", "review"]);

function parseLane(value: string | null): WorkLaneKey | null {
  return value && WORK_LANE_KEYS.has(value) ? (value as WorkLaneKey) : null;
}

export default function PriorityQueuePage() {
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
  const lane = parseLane(searchParams?.get("lane") ?? null);
  const currentWorkspace =
    (workspaceParam
      ? workspaces.find((workspace) => workspace.id === workspaceParam)
      : workspaces[0]) ?? null;

  return (
    <main className="mx-auto max-w-7xl px-6 py-10">
      {lane ? (
        <WorkLaneTable workspaceId={currentWorkspace?.id} lane={lane} />
      ) : (
        <PriorityQueueTable workspaceId={currentWorkspace?.id} />
      )}
    </main>
  );
}
