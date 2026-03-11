"use client";

import { useState } from "react";
import { Button } from "@linear-clone/ui/components/button";
import { Input } from "@linear-clone/ui/components/input";
import { cn } from "@linear-clone/ui/lib/utils";
import { StatusBadge, type TaskStatus, statusConfig } from "./status-badge";
import { PriorityBadge, type TaskPriority, priorityConfig } from "./priority-badge";
import { X, ChevronDown, Loader2, FolderKanban } from "lucide-react";

interface CreateTaskModalProps {
  onClose: () => void;
  onSubmit: (data: {
    projectId: string;
    title: string;
    description?: string;
    status: TaskStatus;
    priority: TaskPriority;
    assigneeId?: string;
    teamId?: string;
    labelIds?: string[];
  }) => Promise<void>;
  projects: Array<{ id: string; name: string; key: string; color: string | null }>;
  defaultProjectId?: string;
  teamId?: string;
  teamKey?: string;
  labels?: Array<{ id: string; name: string; color: string }>;
  users?: Array<{ id: string; name: string | null; avatarUrl: string | null }>;
}

export function CreateTaskModal({
  onClose,
  onSubmit,
  projects,
  defaultProjectId,
  teamId,
  labels = [],
}: CreateTaskModalProps) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [status, setStatus] = useState<TaskStatus>("todo");
  const [priority, setPriority] = useState<TaskPriority>("no_priority");
  const [assigneeId] = useState<string | undefined>();
  const [projectId, setProjectId] = useState<string>(defaultProjectId ?? projects[0]?.id ?? "");
  const [selectedLabelIds, setSelectedLabelIds] = useState<string[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [showStatusPicker, setShowStatusPicker] = useState(false);
  const [showPriorityPicker, setShowPriorityPicker] = useState(false);
  const [showProjectPicker, setShowProjectPicker] = useState(false);

  const selectedProject = projects.find((p) => p.id === projectId);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !projectId) return;

    setIsSubmitting(true);
    try {
      await onSubmit({
        projectId,
        title: title.trim(),
        description: description.trim() || undefined,
        status,
        priority,
        assigneeId,
        teamId,
        labelIds: selectedLabelIds.length > 0 ? selectedLabelIds : undefined,
      });
      onClose();
    } catch (error) {
      console.error("Failed to create task:", error);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-2xl rounded-lg bg-background shadow-xl">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <div className="flex items-center gap-2">
            {selectedProject ? (
              <>
                <span
                  className="h-3 w-3 rounded"
                  style={{ backgroundColor: selectedProject.color ?? "#6366f1" }}
                />
                <span className="font-mono text-sm text-muted-foreground">{selectedProject.key}</span>
              </>
            ) : (
              <span className="text-sm text-muted-foreground">Select project</span>
            )}
            <span className="text-sm font-medium">New Task</span>
          </div>
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="p-4">
            <Input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Task title"
              className="border-0 bg-transparent text-lg font-medium shadow-none focus-visible:ring-0"
              autoFocus
            />

            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Add description..."
              className="mt-2 min-h-[100px] w-full resize-none bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            />

            <div className="mt-4 flex flex-wrap items-center gap-2">
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setShowProjectPicker(!showProjectPicker)}
                  className="flex items-center gap-1.5 rounded-md border border-border px-2 py-1 text-sm hover:bg-muted"
                >
                  <FolderKanban className="h-3.5 w-3.5 text-muted-foreground" />
                  {selectedProject ? (
                    <span className="flex items-center gap-1.5">
                      <span
                        className="h-2 w-2 rounded"
                        style={{ backgroundColor: selectedProject.color ?? "#6366f1" }}
                      />
                      {selectedProject.name}
                    </span>
                  ) : (
                    <span className="text-muted-foreground">Project</span>
                  )}
                  <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                </button>
                {showProjectPicker && (
                  <div className="absolute left-0 top-full z-10 mt-1 max-h-60 w-56 overflow-y-auto rounded-md border border-border bg-popover p-1 shadow-md">
                    {projects.map((project) => (
                      <button
                        key={project.id}
                        type="button"
                        onClick={() => {
                          setProjectId(project.id);
                          setShowProjectPicker(false);
                        }}
                        className={cn(
                          "flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-muted",
                          projectId === project.id && "bg-muted"
                        )}
                      >
                        <span
                          className="h-2 w-2 rounded"
                          style={{ backgroundColor: project.color ?? "#6366f1" }}
                        />
                        <span className="flex-1 truncate text-left">{project.name}</span>
                        <span className="font-mono text-xs text-muted-foreground">{project.key}</span>
                      </button>
                    ))}
                    {projects.length === 0 && (
                      <div className="px-2 py-4 text-center text-sm text-muted-foreground">
                        No projects available
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div className="relative">
                <button
                  type="button"
                  onClick={() => setShowStatusPicker(!showStatusPicker)}
                  className="flex items-center gap-1.5 rounded-md border border-border px-2 py-1 text-sm hover:bg-muted"
                >
                  <StatusBadge status={status} />
                  <span>{statusConfig[status].label}</span>
                  <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                </button>
                {showStatusPicker && (
                  <div className="absolute left-0 top-full z-10 mt-1 w-48 rounded-md border border-border bg-popover p-1 shadow-md">
                    {Object.entries(statusConfig).map(([key, config]) => (
                      <button
                        key={key}
                        type="button"
                        onClick={() => {
                          setStatus(key as TaskStatus);
                          setShowStatusPicker(false);
                        }}
                        className={cn(
                          "flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-muted",
                          status === key && "bg-muted"
                        )}
                      >
                        {config.icon}
                        <span>{config.label}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div className="relative">
                <button
                  type="button"
                  onClick={() => setShowPriorityPicker(!showPriorityPicker)}
                  className="flex items-center gap-1.5 rounded-md border border-border px-2 py-1 text-sm hover:bg-muted"
                >
                  <PriorityBadge priority={priority} />
                  <span>{priorityConfig[priority].label}</span>
                  <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                </button>
                {showPriorityPicker && (
                  <div className="absolute left-0 top-full z-10 mt-1 w-48 rounded-md border border-border bg-popover p-1 shadow-md">
                    {Object.entries(priorityConfig).map(([key, config]) => (
                      <button
                        key={key}
                        type="button"
                        onClick={() => {
                          setPriority(key as TaskPriority);
                          setShowPriorityPicker(false);
                        }}
                        className={cn(
                          "flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-muted",
                          priority === key && "bg-muted"
                        )}
                      >
                        {config.icon}
                        <span>{config.label}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {labels.length > 0 && (
                <div className="flex flex-wrap items-center gap-1">
                  {labels.slice(0, 5).map((label) => (
                    <button
                      key={label.id}
                      type="button"
                      onClick={() => {
                        setSelectedLabelIds((prev) =>
                          prev.includes(label.id) ? prev.filter((id) => id !== label.id) : [...prev, label.id]
                        );
                      }}
                      className={cn(
                        "rounded-full px-2 py-0.5 text-xs transition-opacity",
                        selectedLabelIds.includes(label.id) ? "opacity-100" : "opacity-50"
                      )}
                      style={{ backgroundColor: `${label.color}20`, color: label.color }}
                    >
                      {label.name}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="flex items-center justify-end gap-2 border-t border-border px-4 py-3">
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={!title.trim() || !projectId || isSubmitting}>
              {isSubmitting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Creating...
                </>
              ) : (
                "Create task"
              )}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
