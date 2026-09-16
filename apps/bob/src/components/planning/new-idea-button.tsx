"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation } from "@tanstack/react-query";
import { PlusIcon } from "@radix-ui/react-icons";

import { Button } from "@gmacko/core/ui/button";
import { toast } from "@gmacko/core/ui/toast";
import { getWorkItemEntryPlanSessionHref } from "~/components/work-items/work-item-entry-model";
import { useBobRpcClient } from "~/rpc/react";

interface NewIdeaButtonProps {
  workspaceId: string;
  projectId: string;
  className?: string;
}

export function NewIdeaButton({ workspaceId, projectId, className }: NewIdeaButtonProps) {
  const router = useRouter();
  const rpc = useBobRpcClient();
  const [title, setTitle] = useState("");
  const [open, setOpen] = useState(false);

  // planning.createTask creates an issue via the remote planning API
  const createTask = useMutation({
    mutationFn: (input: { projectId: string; title: string; status: string }) =>
      rpc.planning.createTask(input) as Promise<{ id: string; workItemId?: string }>,
  });
  const createSession = useMutation({
    mutationFn: (input: {
      workspaceId: string;
      projectId: string;
      title: string;
      workItemId: string;
      planningSessionType: string;
    }) => rpc.planning.session.create(input) as Promise<{ id: string }>,
  });

  async function handleCreate() {
    if (!title.trim()) {
      toast("Please enter a title for your idea.");
      return;
    }

    try {
      // Create stub task via planning API
      const task = await createTask.mutateAsync({
        projectId,
        title: title.trim(),
        status: "backlog",
      });

      const workItemId = task.workItemId ?? task.id;

      // Create planning session linked to the new task
      const session = await createSession.mutateAsync({
        workspaceId,
        projectId,
        title: `Shape ${title.trim()}`,
        workItemId,
        planningSessionType: "office_hours",
      });

      // Navigate to split-view
      router.push(getWorkItemEntryPlanSessionHref(workItemId, session.id, workspaceId));
    } catch (err: any) {
      toast(err.message ?? "Failed to create idea");
    }
  }

  if (!open) {
    return (
      <Button
        variant="outline"
        onClick={() => setOpen(true)}
        className={className}
      >
        <PlusIcon className="mr-1.5 h-4 w-4" />
        New Idea
      </Button>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <input
        autoFocus
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") void handleCreate();
          if (e.key === "Escape") { setOpen(false); setTitle(""); }
        }}
        placeholder="What's the idea?"
        className="rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
      />
      <Button
        size="sm"
        onClick={() => void handleCreate()}
        disabled={createTask.isPending || createSession.isPending}
      >
        {createTask.isPending || createSession.isPending ? "Creating..." : "Start"}
      </Button>
      <button
        onClick={() => { setOpen(false); setTitle(""); }}
        className="text-sm text-muted-foreground hover:text-foreground"
      >
        Cancel
      </button>
    </div>
  );
}
