"use client";

import { useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";

import { KanbanBoard } from "~/components/planning/kanban-board";
import { useTRPC } from "~/trpc/react";

export default function PlanningBoardPage() {
  const trpc = useTRPC();
  const searchParams = useSearchParams();

  const { data: workspaceMemberships } = useQuery(
    trpc.workspace.list.queryOptions(undefined, { staleTime: 60_000 }),
  );

  const workspaces = (workspaceMemberships ?? [])
    .map((m: any) => m.workspace)
    .filter(Boolean);

  const workspaceParam = searchParams?.get("workspace") ?? null;
  const currentWorkspace =
    (workspaceParam
      ? workspaces?.find((w: any) => w.id === workspaceParam)
      : workspaces?.[0]) ?? null;

  return <KanbanBoard workspaceId={currentWorkspace?.id} />;
}
