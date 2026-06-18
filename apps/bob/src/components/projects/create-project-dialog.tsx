"use client";

import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { toast } from "@gmacko/core/ui/toast";
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

import { useTRPC } from "~/trpc/react";

interface CreateProjectDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceId: string;
}

const COLORS = [
  "#D4850A", // primary amber
  "#3b82f6",
  "#8b5cf6",
  "#10b981",
  "#ef4444",
  "#ec4899",
  "#6366f1",
  "#14b8a6",
];

function deriveKey(name: string): string {
  return name
    .replace(/[^a-zA-Z0-9\s]/g, "")
    .split(/\s+/)
    .map((w) => w.charAt(0))
    .join("")
    .toUpperCase()
    .slice(0, 6);
}

export function CreateProjectDialog({
  open,
  onOpenChange,
  workspaceId,
}: CreateProjectDialogProps) {
  const router = useRouter();
  const trpc = useTRPC();

  const [mode, setMode] = useState<"forge" | "manual">("forge");
  const [selectedAppId, setSelectedAppId] = useState("");
  const [name, setName] = useState("");
  const [key, setKey] = useState("");
  const [description, setDescription] = useState("");
  const [color, setColor] = useState(COLORS[0]!);

  // Fetch unlinked ForgeGraph apps
  const { data: fgApps, isLoading: loadingApps } = useQuery(
    trpc.forgegraph.listUnlinkedApps.queryOptions(
      { workspaceId },
      { enabled: open && mode === "forge" },
    ),
  );

  const importApp = useMutation(
    trpc.forgegraph.importApp.mutationOptions({
      onSuccess: () => {
        toast("Project imported from ForgeGraph");
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

  const importAllApps = useMutation(
    trpc.forgegraph.importAllApps.mutationOptions({
      onSuccess: (data) => {
        toast(`Imported ${data.imported} projects from ForgeGraph`);
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
    setSelectedAppId("");
    setName("");
    setKey("");
    setDescription("");
    setColor(COLORS[0]!);
  }

  function handleAppSelect(appId: string) {
    setSelectedAppId(appId);
    const app = (fgApps ?? []).find((a: any) => a.id === appId);
    if (app) {
      setName(app.name);
      setKey(deriveKey(app.name) || app.slug.toUpperCase().slice(0, 6));
      setDescription(app.description ?? "");
    }
  }

  function handleNameChange(value: string) {
    setName(value);
    if (!key || key === deriveKey(name)) {
      setKey(deriveKey(value));
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!key.trim()) return;

    if (mode === "forge" && selectedAppId) {
      importApp.mutate({
        workspaceId,
        appId: selectedAppId,
        key: key.trim().toUpperCase(),
      });
    } else {
      if (!name.trim()) return;
      createProject.mutate({
        workspaceId,
        name: name.trim(),
        key: key.trim().toUpperCase(),
        description: description.trim() || undefined,
        color,
      });
    }
  }

  const isPending = importApp.isPending || createProject.isPending || importAllApps.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Create project</DialogTitle>
            <DialogDescription>
              Import from ForgeGraph or create a standalone project.
            </DialogDescription>
          </DialogHeader>

          {/* Mode toggle */}
          <div className="mt-4 flex gap-1 rounded-lg bg-muted p-1">
            <button
              type="button"
              onClick={() => setMode("forge")}
              className={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                mode === "forge" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground"
              }`}
            >
              ForgeGraph App
            </button>
            <button
              type="button"
              onClick={() => setMode("manual")}
              className={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                mode === "manual" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground"
              }`}
            >
              Manual
            </button>
          </div>

          <div className="mt-4 space-y-4">
            {/* ForgeGraph app picker */}
            {mode === "forge" && (
              <div>
                <label className="mb-1.5 block text-sm text-muted-foreground">
                  ForgeGraph App
                </label>
                <select
                  value={selectedAppId}
                  onChange={(e) => handleAppSelect(e.target.value)}
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                >
                  <option value="">
                    {loadingApps ? "Loading apps..." : "Select an app..."}
                  </option>
                  {(fgApps ?? []).map((app: any) => (
                    <option key={app.id} value={app.id}>
                      {app.name}
                      {app.description ? ` — ${app.description.slice(0, 50)}` : ""}
                    </option>
                  ))}
                </select>
                {fgApps && fgApps.length === 0 && !loadingApps && (
                  <p className="mt-1.5 text-xs text-muted-foreground">
                    All ForgeGraph apps are already linked. Connect your token in Settings if you don't see apps.
                  </p>
                )}
                {fgApps && fgApps.length > 1 && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="mt-2 w-full"
                    disabled={importAllApps.isPending}
                    onClick={() =>
                      importAllApps.mutate({ workspaceId })
                    }
                  >
                    {importAllApps.isPending
                      ? "Importing..."
                      : `Import all ${fgApps.length} unlinked apps`}
                  </Button>
                )}
              </div>
            )}

            {/* Name (auto-filled from FG app, editable for manual) */}
            {mode === "manual" && (
              <div>
                <label className="mb-1.5 block text-sm text-muted-foreground">Name</label>
                <Input
                  value={name}
                  onChange={(e) => handleNameChange(e.target.value)}
                  placeholder="My Project"
                  autoFocus
                />
              </div>
            )}

            <div>
              <label className="mb-1.5 block text-sm text-muted-foreground">Key</label>
              <Input
                value={key}
                onChange={(e) => setKey(e.target.value.toUpperCase())}
                placeholder="PROJ"
                maxLength={16}
              />
              <p className="mt-1 text-xs text-muted-foreground">
                Used as prefix for work item IDs (e.g. {key || "PROJ"}-1)
              </p>
            </div>

            {mode === "manual" && (
              <>
                <div>
                  <label className="mb-1.5 block text-sm text-muted-foreground">Description</label>
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
                        className={`size-6 rounded-full transition-all ${
                          color === c ? "ring-2 ring-offset-2 ring-primary" : ""
                        }`}
                        style={{ backgroundColor: c }}
                      />
                    ))}
                  </div>
                </div>
              </>
            )}
          </div>

          <DialogFooter className="mt-6">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={isPending || (mode === "forge" ? !selectedAppId || !key : !name || !key)}
            >
              {isPending ? "Creating..." : mode === "forge" ? "Import" : "Create"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
