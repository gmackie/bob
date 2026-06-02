"use client";

import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "@gmacko/core/ui/toast";

import { useTRPC } from "~/trpc/react";
import { AgentSelect } from "~/components/work-items/agent-select";

interface WorkspaceRow {
  id: string;
  name: string;
  defaultAgentType?: string | null;
}

function WorkspaceAgentRow({ workspace }: { workspace: WorkspaceRow }) {
  const trpc = useTRPC();
  const [value, setValue] = useState<string | null>(
    workspace.defaultAgentType ?? null,
  );
  const setAgent = useMutation(
    trpc.workspace.setDefaultAgent.mutationOptions({
      onError: (err) => {
        toast(err.message, {
          style: { background: "#1a0000", borderColor: "#f43f5e40" },
        });
      },
    }),
  );

  return (
    <div className="flex items-center justify-between gap-4 rounded-xl border border-border bg-card px-5 py-4">
      <div className="space-y-0.5">
        <p className="font-medium text-foreground">{workspace.name}</p>
        <p className="text-sm text-muted-foreground">
          Default agent for this workspace&apos;s work items and OODA sessions
          bound to it (overridden by project / work-item settings).
        </p>
      </div>
      <AgentSelect
        value={value}
        disabled={setAgent.isPending}
        inheritLabel="Default (Claude)"
        onValueChange={(next) => {
          setValue(next);
          setAgent.mutate({ id: workspace.id, defaultAgentType: next });
        }}
      />
    </div>
  );
}

export function WorkspaceAgentsSection() {
  const trpc = useTRPC();
  const { data: workspaces, isLoading } = useQuery(
    trpc.workspace.list.queryOptions(),
  );

  if (isLoading) {
    return <p className="text-sm text-muted-foreground">Loading workspaces…</p>;
  }

  const rows = (workspaces ?? []) as WorkspaceRow[];
  if (rows.length === 0) {
    return <p className="text-sm text-muted-foreground">No workspaces yet.</p>;
  }

  return (
    <div className="space-y-3">
      {rows.map((workspace) => (
        <WorkspaceAgentRow key={workspace.id} workspace={workspace} />
      ))}
    </div>
  );
}
