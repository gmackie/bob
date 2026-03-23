"use client";

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { toast } from "@bob/ui/toast";
import { Button } from "@bob/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@bob/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@bob/ui/select";
import { Input } from "@bob/ui/input";
import { Textarea } from "@bob/ui/textarea";

import { useTRPC } from "~/trpc/react";

interface CreateWorkItemDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId?: string;
  projects?: Array<{ id: string; name: string; key: string }>;
}

const KINDS = [
  { value: "task", label: "Task", description: "An individual unit of work" },
  { value: "issue", label: "Issue", description: "A feature request or bug report" },
  { value: "epic", label: "Epic", description: "A large initiative broken into tasks" },
] as const;

const STATUSES = [
  { value: "backlog", label: "Backlog" },
  { value: "todo", label: "Ready" },
  { value: "in_progress", label: "In Progress" },
] as const;

const PRIORITIES = [
  { value: "no_priority", label: "No priority" },
  { value: "urgent", label: "Urgent" },
  { value: "high", label: "High" },
  { value: "medium", label: "Medium" },
  { value: "low", label: "Low" },
] as const;

export function CreateWorkItemDialog({
  open,
  onOpenChange,
  projectId: defaultProjectId,
  projects = [],
}: CreateWorkItemDialogProps) {
  const router = useRouter();
  const trpc = useTRPC();

  const [kind, setKind] = useState<"issue" | "epic" | "task">("task");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [projectId, setProjectId] = useState(defaultProjectId ?? "");
  const [status, setStatus] = useState("todo");
  const [priority, setPriority] = useState("no_priority");

  const createTask = useMutation(
    trpc.planning.createTask.mutationOptions({
      onSuccess: (data) => {
        toast(`Created ${data.identifier}`);
        onOpenChange(false);
        resetForm();
        router.refresh();
      },
      onError: (err) => {
        toast(err.message, { style: { background: "#1a0000", borderColor: "#f43f5e40" } });
      },
    }),
  );

  function resetForm() {
    setKind("task");
    setTitle("");
    setDescription("");
    setStatus("todo");
    setPriority("no_priority");
    if (!defaultProjectId) setProjectId("");
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim() || !projectId) return;
    createTask.mutate({
      projectId,
      title: title.trim(),
      description: description.trim() || undefined,
      kind,
      status: status as "backlog" | "todo" | "in_progress" | "in_review" | "done",
      priority: priority as "no_priority" | "urgent" | "high" | "medium" | "low",
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Create work item</DialogTitle>
            <DialogDescription>
              Add a new work item to your project.
            </DialogDescription>
          </DialogHeader>

          <div className="mt-4 space-y-4">
            <div>
              <label className="mb-1.5 block text-sm text-muted-foreground">Kind</label>
              <div className="flex gap-1 rounded-md border border-border bg-muted/30 p-1">
                {KINDS.map((k) => (
                  <button
                    key={k.value}
                    type="button"
                    onClick={() => setKind(k.value)}
                    className={`flex-1 rounded-sm px-3 py-1.5 text-sm font-medium transition-colors ${
                      kind === k.value
                        ? "bg-background text-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                    title={k.description}
                  >
                    {k.label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="mb-1.5 block text-sm text-muted-foreground">Title</label>
              <Input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="What needs to be done?"
                autoFocus
              />
            </div>

            <div>
              <label className="mb-1.5 block text-sm text-muted-foreground">Description</label>
              <Textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Add details..."
                className="min-h-[60px]"
              />
            </div>

            {!defaultProjectId && projects.length > 0 && (
              <div>
                <label className="mb-1.5 block text-sm text-muted-foreground">Project</label>
                <Select value={projectId} onValueChange={setProjectId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select project" />
                  </SelectTrigger>
                  <SelectContent>
                    {projects.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.key} — {p.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1.5 block text-sm text-muted-foreground">Status</label>
                <Select value={status} onValueChange={setStatus}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {STATUSES.map((s) => (
                      <SelectItem key={s.value} value={s.value}>
                        {s.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <label className="mb-1.5 block text-sm text-muted-foreground">Priority</label>
                <Select value={priority} onValueChange={setPriority}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PRIORITIES.map((p) => (
                      <SelectItem key={p.value} value={p.value}>
                        {p.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={!title.trim() || !projectId || createTask.isPending}
            >
              {createTask.isPending ? "Creating..." : "Create"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
