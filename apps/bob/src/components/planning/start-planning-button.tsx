"use client";

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useRouter } from "next/navigation";

import { Button } from "@gmacko/core/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@gmacko/core/ui/dialog";
import { Input } from "@gmacko/core/ui/input";
import { Textarea } from "@gmacko/core/ui/textarea";
import { toast } from "@gmacko/core/ui/toast";
import { PlusIcon } from "@radix-ui/react-icons";

import { useChatPanel } from "~/components/chat/chat-panel-provider";
import { useTRPC } from "~/trpc/react";
import { getPlanningSessionHref } from "./planning-shell-model";

interface StartPlanningButtonProps {
  workspaceId: string;
  projectId: string;
  projectName?: string;
  label?: string;
  disabled?: boolean;
  disabledReason?: string;
  openTarget?: "panel" | "route";
}

export function StartPlanningButton({
  workspaceId,
  projectId,
  projectName,
  label = "Plan with Bob",
  disabled = false,
  disabledReason = "Planning is not available yet.",
  openTarget = "panel",
}: StartPlanningButtonProps) {
  const trpc = useTRPC();
  const router = useRouter();
  const { openPanel } = useChatPanel();
  const [open, setOpen] = useState(false);
  const [goal, setGoal] = useState("");
  const [workingDirectory, setWorkingDirectory] = useState("/");

  const createSession = useMutation(
    trpc.planSession.create.mutationOptions(),
  );

  const startSession = useMutation(
    trpc.planSession.start.mutationOptions(),
  );

  const isPending = createSession.isPending || startSession.isPending;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!goal.trim()) return;

    try {
      const session = await createSession.mutateAsync({
        workspaceId,
        projectId,
        workingDirectory,
        title: goal.trim().slice(0, 256),
      });

      await startSession.mutateAsync({
        sessionId: session.id,
        workspaceId,
        projectId,
        projectName: projectName ?? "Project",
        workingDirectory,
      });

      if (openTarget === "route") {
        router.push(getPlanningSessionHref(session.id, workspaceId));
      } else {
        openPanel({
          sessionId: session.id,
          label: `Planning: ${goal.trim().slice(0, 40)}`,
        });
      }

      setOpen(false);
      setGoal("");
      setWorkingDirectory("/");
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to start planning session";
      toast(message, {
        style: { background: "#1a0000", borderColor: "#f43f5e40" },
      });
    }
  }

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={() => setOpen(true)}
        disabled={disabled}
        title={disabled ? disabledReason : undefined}
      >
        <PlusIcon className="mr-1.5 h-3.5 w-3.5" />
        {label}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <form onSubmit={handleSubmit}>
            <DialogHeader>
              <DialogTitle>Plan with Bob</DialogTitle>
              <DialogDescription>
                Describe your goal and Bob will help break it into actionable
                tasks.
              </DialogDescription>
            </DialogHeader>

            <div className="mt-4 space-y-4">
              <div>
                <label className="mb-1.5 block text-sm text-secondary-foreground">
                  Goal
                </label>
                <Textarea
                  value={goal}
                  onChange={(e) => setGoal(e.target.value)}
                  placeholder="What do you want to accomplish?"
                  className="min-h-[80px]"
                  autoFocus
                />
              </div>
              <div>
                <label className="mb-1.5 block text-sm text-secondary-foreground">
                  Working directory
                </label>
                <Input
                  value={workingDirectory}
                  onChange={(e) => setWorkingDirectory(e.target.value)}
                  placeholder="/"
                />
              </div>
            </div>

            <DialogFooter>
              <Button
                type="button"
                variant="ghost"
                onClick={() => setOpen(false)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={!goal.trim() || isPending}>
                {isPending ? "Starting..." : "Start Planning"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
