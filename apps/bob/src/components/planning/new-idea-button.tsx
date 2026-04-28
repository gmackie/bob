"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation } from "@tanstack/react-query";
import { PlusIcon } from "@radix-ui/react-icons";

import { Button } from "@bob/ui/button";
import { toast } from "@bob/ui/toast";
import { useTRPC } from "~/trpc/react";

interface NewIdeaButtonProps {
  workspaceId: string;
  projectId: string;
  className?: string;
}

export function NewIdeaButton({ workspaceId, projectId, className }: NewIdeaButtonProps) {
  const router = useRouter();
  const trpc = useTRPC();
  const [title, setTitle] = useState("");
  const [open, setOpen] = useState(false);

  // planning.createTask creates an issue via the remote planning API
  const createTask = useMutation(
    trpc.planning.createTask.mutationOptions(),
  );
  const createSession = useMutation(
    trpc.planSession.create.mutationOptions(),
  );

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

      // Create planning session linked to the new task
      const session = await createSession.mutateAsync({
        workspaceId,
        projectId,
        title: `Shape ${title.trim()}`,
        planningSessionType: "office_hours",
      });

      // Navigate to split-view
      router.push(`/work-items/${task.id}/plan/${session.id}`);
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
