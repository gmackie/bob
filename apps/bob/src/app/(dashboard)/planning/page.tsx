"use client";

import { useSearchParams, useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";

import { cn } from "@gmacko/core/ui";
import { PlanningDashboard } from "~/components/planning/planning-dashboard";
import { useTRPC } from "~/trpc/react";

type WorkspaceMembership = {
  workspace?: { id: string; name?: string | null } | null;
};

export default function PlanningDashboardPage() {
  const trpc = useTRPC();
  const router = useRouter();
  const searchParams = useSearchParams();

  const { data: workspaceMemberships } = useQuery(
    trpc.workspace.list.queryOptions(undefined, { staleTime: 60_000 }),
  );

  const memberships = (workspaceMemberships ?? []) as unknown as WorkspaceMembership[];
  const workspaces = memberships.flatMap((m) => (m.workspace ? [m.workspace] : []));

  const workspaceParam = searchParams?.get("workspace") ?? null;
  const currentWorkspace =
    (workspaceParam
      ? workspaces.find((w) => w.id === workspaceParam)
      : workspaces?.[0]) ?? null;

  return (
    <div className="flex flex-col gap-4">
      {workspaces.length > 1 && (
        <div className="flex items-center gap-1 rounded-lg border border-border bg-card p-1">
          {workspaces.map((ws: any) => (
            <button
              key={ws.id}
              onClick={() => router.push(`/planning?workspace=${ws.id}`)}
              className={cn(
                "rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                ws.id === currentWorkspace?.id
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted/50",
              )}
            >
              {ws.name || ws.id.slice(0, 8)}
            </button>
          ))}
        </div>
      )}
      <PlanningDashboard workspaceId={currentWorkspace?.id} />
    </div>
  );
}
