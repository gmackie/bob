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
import { Input } from "@bob/ui/input";
import { Textarea } from "@bob/ui/textarea";

import { useTRPC } from "~/trpc/react";

interface CreateProjectDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceId: string;
}

const COLORS = [
  "#3b82f6",
  "#8b5cf6",
  "#f59e0b",
  "#10b981",
  "#ef4444",
  "#ec4899",
  "#6366f1",
  "#14b8a6",
];

export function CreateProjectDialog({
  open,
  onOpenChange,
  workspaceId,
}: CreateProjectDialogProps) {
  const router = useRouter();
  const trpc = useTRPC();

  const [name, setName] = useState("");
  const [key, setKey] = useState("");
  const [description, setDescription] = useState("");
  const [color, setColor] = useState(COLORS[0]!);

  const createProject = useMutation(
    trpc.project.create.mutationOptions({
      onSuccess: () => {
        toast("Project created");
        onOpenChange(false);
        resetForm();
        router.refresh();
      },
      onError: (err) => {
        toast(err.message, {
          style: { background: "#1a0000", borderColor: "#f43f5e40" },
        });
      },
    }),
  );

  function resetForm() {
    setName("");
    setKey("");
    setDescription("");
    setColor(COLORS[0]!);
  }

  function handleNameChange(value: string) {
    setName(value);
    if (!key || key === deriveKey(name)) {
      setKey(deriveKey(value));
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !key.trim()) return;
    createProject.mutate({
      workspaceId,
      name: name.trim(),
      key: key.trim().toUpperCase(),
      description: description.trim() || undefined,
      color,
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Create project</DialogTitle>
            <DialogDescription>
              Projects organize work items into logical groups.
            </DialogDescription>
          </DialogHeader>

          <div className="mt-4 space-y-4">
            <div>
              <label className="mb-1.5 block text-sm text-muted-foreground">Name</label>
              <Input
                value={name}
                onChange={(e) => handleNameChange(e.target.value)}
                placeholder="My Project"
                autoFocus
              />
            </div>

            <div>
              <label className="mb-1.5 block text-sm text-muted-foreground">Key</label>
              <Input
                value={key}
                onChange={(e) => setKey(e.target.value.toUpperCase())}
                placeholder="PROJ"
                maxLength={16}
              />
            </div>

            <div>
              <label className="mb-1.5 block text-sm text-muted-foreground">
                Description
              </label>
              <Textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="What is this project about?"
                className="min-h-[60px]"
              />
            </div>

            <div>
              <label className="mb-1.5 block text-sm text-muted-foreground">Color</label>
              <div className="flex gap-2">
                {COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setColor(c)}
                    className="size-7 rounded-full border-2 transition"
                    style={{
                      backgroundColor: c,
                      borderColor: c === color ? "white" : "transparent",
                    }}
                  />
                ))}
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
              disabled={
                !name.trim() || !key.trim() || createProject.isPending
              }
            >
              {createProject.isPending ? "Creating..." : "Create"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function deriveKey(name: string): string {
  return name
    .trim()
    .replace(/[^a-zA-Z0-9\s]/g, "")
    .split(/\s+/)
    .map((w) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 6);
}
