"use client";

import { useState } from "react";
import { Button } from "@linear-clone/ui/components/button";
import { Input } from "@linear-clone/ui/components/input";
import { Label } from "@linear-clone/ui/components/label";
import { cn } from "@linear-clone/ui/lib/utils";
import { X, Loader2, ChevronDown } from "lucide-react";

const PROJECT_COLORS = [
  "#ef4444", // red
  "#f97316", // orange
  "#f59e0b", // amber
  "#84cc16", // lime
  "#22c55e", // green
  "#14b8a6", // teal
  "#06b6d4", // cyan
  "#3b82f6", // blue
  "#6366f1", // indigo
  "#8b5cf6", // violet
  "#a855f7", // purple
  "#ec4899", // pink
];

const PROJECT_STATUSES = [
  { value: "planned", label: "Planned" },
  { value: "in_progress", label: "In Progress" },
  { value: "paused", label: "Paused" },
  { value: "completed", label: "Completed" },
  { value: "canceled", label: "Canceled" },
];

interface CreateProjectModalProps {
  workspaceId?: string;
  teams: Array<{ id: string; name: string; key: string }>;
  onClose: () => void;
  onSubmit: (data: {
    name: string;
    description?: string;
    color?: string;
    status?: string;
    teamIds?: string[];
    createForgeRepository?: boolean;
    forgeRepositoryName?: string;
    forgeRepositoryStorageBackend?: "s3" | "rsync";
    forgeRepositoryStoragePrefix?: string;
  }) => Promise<void>;
}

export function CreateProjectModal({
  teams,
  onClose,
  onSubmit,
}: CreateProjectModalProps) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [color, setColor] = useState(PROJECT_COLORS[8]); // indigo default
  const [status, setStatus] = useState("planned");
  const [selectedTeamIds, setSelectedTeamIds] = useState<string[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showStatusPicker, setShowStatusPicker] = useState(false);
  const [createForgeRepository, setCreateForgeRepository] = useState(false);
  const [forgeRepositoryName, setForgeRepositoryName] = useState("");
  const [forgeRepositoryStorageBackend, setForgeRepositoryStorageBackend] = useState<"s3" | "rsync">("s3");
  const [forgeRepositoryStoragePrefix, setForgeRepositoryStoragePrefix] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    setIsSubmitting(true);
    try {
      await onSubmit({
        name: name.trim(),
        description: description.trim() || undefined,
        color,
        status,
        teamIds: selectedTeamIds.length > 0 ? selectedTeamIds : undefined,
        createForgeRepository,
        forgeRepositoryName: forgeRepositoryName.trim() || undefined,
        forgeRepositoryStorageBackend,
        forgeRepositoryStoragePrefix: forgeRepositoryStoragePrefix.trim() || undefined,
      });
      onClose();
    } catch (error) {
      console.error("Failed to create project:", error);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-md rounded-lg bg-background shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h2 className="font-semibold">New Project</h2>
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit}>
          <div className="space-y-4 p-4">
            {/* Name and color */}
            <div className="flex gap-3">
              <div className="flex-1 space-y-2">
                <Label htmlFor="name">Name</Label>
                <Input
                  id="name"
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g., Mobile App"
                  autoFocus
                />
              </div>
              <div className="space-y-2">
                <Label>Color</Label>
                <div className="grid grid-cols-6 gap-1">
                  {PROJECT_COLORS.map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setColor(c)}
                      className={cn(
                        "h-6 w-6 rounded-md transition-transform",
                        color === c && "ring-2 ring-primary ring-offset-2"
                      )}
                      style={{ backgroundColor: c }}
                    />
                  ))}
                </div>
              </div>
            </div>

            {/* Description */}
            <div className="space-y-2">
              <Label htmlFor="description">Description (optional)</Label>
              <textarea
                id="description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="What is this project about?"
                className="min-h-[80px] w-full resize-none rounded-md border border-input bg-background px-3 py-2 text-sm outline-none placeholder:text-muted-foreground focus:ring-1 focus:ring-primary"
              />
            </div>

            {/* Status */}
            <div className="relative space-y-2">
              <Label>Status</Label>
              <button
                type="button"
                onClick={() => setShowStatusPicker(!showStatusPicker)}
                className="flex w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm hover:bg-muted"
              >
                <span>
                  {PROJECT_STATUSES.find((s) => s.value === status)?.label ?? status}
                </span>
                <ChevronDown className="h-4 w-4 text-muted-foreground" />
              </button>
              {showStatusPicker && (
                <div className="absolute left-0 top-full z-10 mt-1 w-full rounded-md border border-border bg-popover p-1 shadow-md">
                  {PROJECT_STATUSES.map((s) => (
                    <button
                      key={s.value}
                      type="button"
                      onClick={() => {
                        setStatus(s.value);
                        setShowStatusPicker(false);
                      }}
                      className={cn(
                        "flex w-full items-center rounded px-2 py-1.5 text-sm hover:bg-muted",
                        status === s.value && "bg-muted"
                      )}
                    >
                      {s.label}
                    </button>
                  ))}
                </div>
              )}
            </div>

              {/* Teams */}
            {teams.length > 0 && (
              <div className="space-y-2">
                <Label>Teams</Label>
                <div className="flex flex-wrap gap-2">
                  {teams.map((team) => (
                    <button
                      key={team.id}
                      type="button"
                      onClick={() => {
                        setSelectedTeamIds((prev) =>
                          prev.includes(team.id)
                            ? prev.filter((id) => id !== team.id)
                            : [...prev, team.id]
                        );
                      }}
                      className={cn(
                        "rounded-md border px-3 py-1 text-sm transition-colors",
                        selectedTeamIds.includes(team.id)
                          ? "border-primary bg-primary/10 text-primary"
                          : "border-border hover:bg-muted"
                      )}
                    >
                      {team.name}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Forge Repository */}
            <div className="space-y-3 rounded-md border border-border bg-muted/30 p-3">
              <label className="flex items-center justify-between">
                <span className="text-sm font-medium">Create Forge repository</span>
                <button
                  type="button"
                  className={cn(
                    "relative inline-flex h-5 w-9 items-center rounded-full border transition-colors",
                    createForgeRepository ? "bg-primary border-primary" : "bg-muted border-border"
                  )}
                  onClick={() => setCreateForgeRepository((prev) => !prev)}
                >
                  <span
                    className={cn(
                      "inline-block h-4 w-4 rounded-full bg-white transition-transform",
                      createForgeRepository ? "translate-x-4" : "translate-x-0"
                    )}
                  />
                </button>
              </label>

              {createForgeRepository && (
                <div className="space-y-3">
                  <div>
                    <Label htmlFor="forgeRepositoryName">Repository Name</Label>
                    <Input
                      id="forgeRepositoryName"
                      value={forgeRepositoryName}
                      onChange={(e) => setForgeRepositoryName(e.target.value)}
                      placeholder="Defaults to project id"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Storage backend</Label>
                    <div className="flex gap-2">
                      {(["s3", "rsync"] as const).map((backend) => (
                        <button
                          key={backend}
                          type="button"
                          className={cn(
                            "rounded-md border px-3 py-1.5 text-sm",
                            forgeRepositoryStorageBackend === backend
                              ? "border-primary bg-primary/10 text-primary"
                              : "border-border hover:bg-muted"
                          )}
                          onClick={() => setForgeRepositoryStorageBackend(backend)}
                        >
                          {backend.toUpperCase()}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <Label htmlFor="forgeRepositoryStoragePrefix">Storage prefix (optional)</Label>
                    <Input
                      id="forgeRepositoryStoragePrefix"
                      value={forgeRepositoryStoragePrefix}
                      onChange={(e) => setForgeRepositoryStoragePrefix(e.target.value)}
                      placeholder="workspace/project-id"
                    />
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Footer */}
          <div className="flex items-center justify-end gap-2 border-t border-border px-4 py-3">
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={!name.trim() || isSubmitting}>
              {isSubmitting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Creating...
                </>
              ) : (
                "Create project"
              )}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
