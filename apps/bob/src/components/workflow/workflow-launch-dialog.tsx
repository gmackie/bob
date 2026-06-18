"use client";

import React, { useEffect, useRef, useState } from "react";
import { FileTextIcon, ImageIcon, UploadIcon } from "@radix-ui/react-icons";

import { Badge } from "@gmacko/core/ui/badge";
import { Button } from "@gmacko/core/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@gmacko/core/ui/dialog";
import { Textarea } from "@gmacko/core/ui/textarea";
import { cn } from "@gmacko/core/ui";

export type WorkflowLaunchIntent = "shape" | "breakdown";

interface WorkItemSummary {
  id: string;
  identifier: string;
  title: string;
  kind: string;
}

interface WorkflowLaunchContextSource {
  id: string;
  label: string;
  path: string;
  detail: string;
  defaultSelected: boolean;
}

export interface WorkflowLaunchAttachment {
  id: string;
  name: string;
  sizeLabel: string;
  content?: string;
  file?: File;
}

export interface WorkflowLaunchExperience {
  intent: WorkflowLaunchIntent;
  title: string;
  description: string;
  confirmLabel: string;
  defaultNotes: string;
  prototypeNote: string;
  skills: string[];
  focusAreas: string[];
  signals: Array<{ label: string; value: string }>;
  repoSources: WorkflowLaunchContextSource[];
}

interface WorkflowLaunchDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  intent: WorkflowLaunchIntent | null;
  workItem: WorkItemSummary;
  requirementCount: number;
  childTaskCount: number;
  onConfirm: (
    input: ReturnType<typeof buildWorkflowLaunchContext>,
  ) => void | Promise<void>;
}

interface WorkflowLaunchDialogBodyProps {
  experience: WorkflowLaunchExperience;
  notes: string;
  selectedSourceIds: string[];
  attachedFiles: WorkflowLaunchAttachment[];
  isSubmitting: boolean;
  onNotesChange: (value: string) => void;
  onToggleSource: (id: string) => void;
  onBrowseFiles: () => void;
  onRemoveFile: (id: string) => void;
  onDropFiles: (files: FileList | File[]) => void;
  onSubmit: () => void;
  onCancel: () => void;
}

function buildSignalValue(count: number, singular: string, plural: string) {
  return `${count} ${count === 1 ? singular : plural}`;
}

function formatFileSize(size: number) {
  if (size >= 1024 * 1024) {
    return `${(size / (1024 * 1024)).toFixed(1)} MB`;
  }
  if (size >= 1024) {
    return `${Math.round(size / 1024)} KB`;
  }
  return `${size} B`;
}

function isTextLikeFile(file: File) {
  if (file.type.startsWith("text/")) {
    return true;
  }

  return /\.(md|mdx|txt|json|ya?ml|csv|ts|tsx|js|jsx|html|css|scss)$/i.test(
    file.name,
  );
}

async function materializeWorkflowAttachments(
  attachedFiles: WorkflowLaunchAttachment[],
): Promise<WorkflowLaunchAttachment[]> {
  return Promise.all(
    attachedFiles.map(async (file) => {
      if (file.content || !file.file || !isTextLikeFile(file.file)) {
        return {
          id: file.id,
          name: file.name,
          sizeLabel: file.sizeLabel,
          content: file.content,
        };
      }

      const rawContent = await file.file.text();
      const content =
        rawContent.length > 8000
          ? `${rawContent.slice(0, 8000)}\n...[truncated]`
          : rawContent;

      return {
        id: file.id,
        name: file.name,
        sizeLabel: file.sizeLabel,
        content,
      };
    }),
  );
}

export function buildWorkflowLaunchContext(input: {
  experience: WorkflowLaunchExperience;
  notes: string;
  selectedSourceIds: string[];
  attachedFiles: WorkflowLaunchAttachment[];
  workItem: WorkItemSummary;
}) {
  return {
    intent: input.experience.intent,
    notes: input.notes,
    workItem: input.workItem,
    selectedRepoSources: input.experience.repoSources
      .filter((source) => input.selectedSourceIds.includes(source.id))
      .map(({ id, label, path, detail }) => ({
        id,
        label,
        path,
        detail,
      })),
    attachedFiles: input.attachedFiles.map(({ name, sizeLabel, content }) => ({
      name,
      sizeLabel,
      content,
    })),
  };
}

export type WorkflowPlanningLaunchContext = ReturnType<
  typeof buildWorkflowLaunchContext
>;

export function getWorkflowLaunchExperience(input: {
  intent: WorkflowLaunchIntent;
  workItem: WorkItemSummary;
  requirementCount: number;
  childTaskCount: number;
}): WorkflowLaunchExperience {
  const sharedSignals = [
    { label: "Work item", value: input.workItem.identifier },
    {
      label: "Requirements",
      value: buildSignalValue(input.requirementCount, "item", "items"),
    },
    {
      label: "Child tasks",
      value: buildSignalValue(input.childTaskCount, "task", "tasks"),
    },
  ];

  if (input.intent === "shape") {
    return {
      intent: "shape",
      title: "Shape with Bob",
      description:
        "Open a guided shaping session for this work item. Add notes, docs, screenshots, and repo context before Bob starts asking one question at a time.",
      confirmLabel: "Open shaping session",
      defaultNotes: `Help shape ${input.workItem.identifier} ${input.workItem.title} into a clearer epic or issue. Ask one question at a time, define scope and success signals, and prepare a BRD if the work is broad enough.`,
      prototypeNote:
        "Prototype handoff: the context bundle UI is live for design review, while backend attachment wiring comes next.",
      skills: ["work-item-shaping"],
      focusAreas: [
        "Problem framing",
        "Scope and non-goals",
        "Success signals",
        "Requirement categories",
      ],
      signals: sharedSignals,
      repoSources: [
        {
          id: "parent-work-item",
          label: "Parent work item",
          path: input.workItem.identifier,
          detail: "Carry the current title and description into the shaping conversation.",
          defaultSelected: true,
        },
        {
          id: "repo-readme",
          label: "Project overview",
          path: "README.md",
          detail: "Anchor the conversation in product language, setup context, and existing capabilities.",
          defaultSelected: true,
        },
        {
          id: "repo-plans",
          label: "Planning docs",
          path: "docs/ai",
          detail: "Pull prior proposals, product notes, and implementation plans if this work already exists on paper.",
          defaultSelected: false,
        },
        {
          id: "repo-requirements",
          label: "Requirements checklist",
          path: "parent requirements",
          detail:
            input.requirementCount > 0
              ? `This item already has ${buildSignalValue(input.requirementCount, "requirement", "requirements")} to refine.`
              : "Use this as the landing zone once the BRD or shape is clear enough to record requirements.",
          defaultSelected: input.requirementCount > 0,
        },
        {
          id: "repo-open-selection",
          label: "Open repo selection",
          path: "current repository view",
          detail: "Prototype slot for dragging files in from the repository browser once that surface is wired.",
          defaultSelected: false,
        },
      ],
    };
  }

  return {
    intent: "breakdown",
    title: "Break into tasks",
    description:
      "Open a planning session that turns parent scope into linked child tasks, dependency order, and requirement ownership.",
    confirmLabel: "Open planning session",
    defaultNotes: `Break ${input.workItem.identifier} ${input.workItem.title} into linked child tasks. Keep the parent as the scope owner, assign requirement ownership, and capture dependency order only where it is real.`,
    prototypeNote:
      "Prototype handoff: file and repo selections are visual for now so we can refine the workflow before wiring backend attachments.",
    skills: ["work-item-breakdown"],
    focusAreas: [
      "Task boundaries",
      "Requirement owners",
      "Dependency order",
      "Execution readiness",
    ],
    signals: sharedSignals,
    repoSources: [
      {
        id: "parent-work-item",
        label: "Parent issue or epic",
        path: input.workItem.identifier,
        detail: "Use the parent description as the source of truth for scope while drafting child tasks.",
        defaultSelected: true,
      },
      {
        id: "repo-brd",
        label: "BRD or documentation artifact",
        path: "attached documentation",
        detail: "Bring in the longer-form scope doc before deriving task boundaries.",
        defaultSelected: true,
      },
      {
        id: "repo-requirements",
        label: "Requirements checklist",
        path: "parent requirements",
        detail:
          input.requirementCount > 0
            ? `Map ${buildSignalValue(input.requirementCount, "requirement", "requirements")} to primary task owners.`
            : "Start by turning the BRD into requirements before finalizing the task list.",
        defaultSelected: true,
      },
      {
        id: "repo-children",
        label: "Existing child tasks",
        path: "linked work items",
        detail:
          input.childTaskCount > 0
            ? `Review ${buildSignalValue(input.childTaskCount, "existing task", "existing tasks")} before creating more.`
            : "No child tasks exist yet, so the planning session can start from a clean task map.",
        defaultSelected: input.childTaskCount > 0,
      },
      {
        id: "repo-open-selection",
        label: "Open repo selection",
        path: "current repository view",
        detail: "Prototype entry point for pulling code paths, stories, or docs directly from the repo browser.",
        defaultSelected: false,
      },
    ],
  };
}

export function WorkflowLaunchDialog({
  open,
  onOpenChange,
  intent,
  workItem,
  requirementCount,
  childTaskCount,
  onConfirm,
}: WorkflowLaunchDialogProps) {
  const [notes, setNotes] = useState("");
  const [selectedSourceIds, setSelectedSourceIds] = useState<string[]>([]);
  const [attachedFiles, setAttachedFiles] = useState<WorkflowLaunchAttachment[]>(
    [],
  );
  const [isSubmitting, setIsSubmitting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const experience = intent
    ? getWorkflowLaunchExperience({
        intent,
        workItem,
        requirementCount,
        childTaskCount,
      })
    : null;

  useEffect(() => {
    if (!intent || !open) return;
    const nextExperience = getWorkflowLaunchExperience({
      intent,
      workItem,
      requirementCount,
      childTaskCount,
    });
    setNotes(nextExperience.defaultNotes);
    setSelectedSourceIds(
      nextExperience.repoSources
        .filter((source) => source.defaultSelected)
        .map((source) => source.id),
    );
    setAttachedFiles([]);
  }, [
    childTaskCount,
    intent,
    open,
    requirementCount,
    workItem.id,
    workItem.identifier,
    workItem.kind,
    workItem.title,
  ]);

  function appendFiles(files: FileList | File[]) {
    const nextFiles = Array.from(files).map((file, index) => ({
      id: `${file.name}-${file.size}-${index}`,
      name: file.name,
      sizeLabel: formatFileSize(file.size),
      file,
    }));

    setAttachedFiles((current) => {
      const existingIds = new Set(current.map((file) => file.id));
      return [...current, ...nextFiles.filter((file) => !existingIds.has(file.id))];
    });
  }

  if (!experience) {
    return null;
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl border-white/10 bg-[linear-gradient(135deg,rgba(10,16,30,0.98),rgba(13,24,43,0.98))] p-0 text-foreground">
        <div className="border-b border-white/10 px-6 py-5">
          <DialogHeader>
            <DialogTitle>{experience.title}</DialogTitle>
            <DialogDescription>{experience.description}</DialogDescription>
          </DialogHeader>
        </div>

        <div className="px-6 pb-6">
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={(event) => {
              if (event.target.files?.length) {
                appendFiles(event.target.files);
                event.target.value = "";
              }
            }}
          />
          <WorkflowLaunchDialogBody
            experience={experience}
            notes={notes}
            selectedSourceIds={selectedSourceIds}
            attachedFiles={attachedFiles}
            isSubmitting={isSubmitting}
            onNotesChange={setNotes}
            onToggleSource={(id) => {
              setSelectedSourceIds((current) =>
                current.includes(id)
                  ? current.filter((entry) => entry !== id)
                  : [...current, id],
              );
            }}
            onBrowseFiles={() => fileInputRef.current?.click()}
            onRemoveFile={(id) => {
              setAttachedFiles((current) =>
                current.filter((file) => file.id !== id),
              );
            }}
            onDropFiles={(files) => appendFiles(files)}
            onSubmit={async () => {
              setIsSubmitting(true);
              try {
                const hydratedAttachments =
                  await materializeWorkflowAttachments(attachedFiles);
                await onConfirm(
                  buildWorkflowLaunchContext({
                    experience,
                    notes,
                    selectedSourceIds,
                    attachedFiles: hydratedAttachments,
                    workItem,
                  }),
                );
                onOpenChange(false);
              } finally {
                setIsSubmitting(false);
              }
            }}
            onCancel={() => onOpenChange(false)}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function WorkflowLaunchDialogBody({
  experience,
  notes,
  selectedSourceIds,
  attachedFiles,
  isSubmitting,
  onNotesChange,
  onToggleSource,
  onBrowseFiles,
  onRemoveFile,
  onDropFiles,
  onSubmit,
  onCancel,
}: WorkflowLaunchDialogBodyProps) {
  const [isDragging, setIsDragging] = useState(false);
  const selectedCount = selectedSourceIds.length + attachedFiles.length;

  return (
    <form
      className="mt-5 space-y-5"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <div>
        <h2 className="text-2xl font-display font-semibold text-foreground">
          {experience.title}
        </h2>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-300/75">
          {experience.description}
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        {experience.skills.map((skill) => (
          <Badge
            key={skill}
            className="border-emerald-400/30 bg-emerald-500/10 text-emerald-100"
          >
            {skill}
          </Badge>
        ))}
        {experience.signals.map((signal) => (
          <Badge
            key={signal.label}
            className="border-white/10 bg-white/5 text-slate-200"
          >
            {signal.label}: {signal.value}
          </Badge>
        ))}
      </div>

      <div className="grid gap-5 xl:grid-cols-[1.15fr_0.85fr]">
        <div className="rounded-[1.5rem] border border-white/10 bg-black/10 p-4">
          <div className="text-xs uppercase tracking-[0.22em] text-slate-400">
            Session brief
          </div>
          <div className="mt-3 text-sm leading-6 text-slate-200/75">
            Draft the kickoff note Bob will see when this session opens.
          </div>
          <Textarea
            value={notes}
            onChange={(event) => onNotesChange(event.target.value)}
            className="mt-4 min-h-[160px] border-white/10 bg-slate-950/50 text-slate-100"
          />
        </div>

        <div className="space-y-4">
          <div className="rounded-[1.5rem] border border-white/10 bg-black/10 p-4">
            <div className="text-xs uppercase tracking-[0.22em] text-slate-400">
              Context bundle
            </div>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <div className="rounded-2xl border border-white/8 bg-slate-950/45 px-3 py-3">
                <div className="text-[11px] uppercase tracking-[0.18em] text-slate-500">
                  Selected
                </div>
                <div className="mt-2 text-lg font-semibold text-foreground">
                  {selectedCount}
                </div>
              </div>
              <div className="rounded-2xl border border-white/8 bg-slate-950/45 px-3 py-3">
                <div className="text-[11px] uppercase tracking-[0.18em] text-slate-500">
                  Focus areas
                </div>
                <div className="mt-2 text-lg font-semibold text-foreground">
                  {experience.focusAreas.length}
                </div>
              </div>
            </div>
            <p className="mt-4 text-sm leading-6 text-slate-300/70">
              {experience.prototypeNote}
            </p>
          </div>

          <div className="rounded-[1.5rem] border border-white/10 bg-black/10 p-4">
            <div className="text-xs uppercase tracking-[0.22em] text-slate-400">
              Focus areas
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {experience.focusAreas.map((area) => (
                <Badge
                  key={area}
                  className="border-white/10 bg-slate-950/45 text-slate-200"
                >
                  {area}
                </Badge>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="grid gap-5 xl:grid-cols-[0.92fr_1.08fr]">
        <div className="rounded-[1.5rem] border border-white/10 bg-black/10 p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-xs uppercase tracking-[0.22em] text-slate-400">
                Drag in context
              </div>
              <div className="mt-2 text-sm leading-6 text-slate-300/70">
                Drop screenshots, docs, notes, or exported specs here to include
                them in the launch bundle.
              </div>
            </div>
            <Button type="button" variant="outline" onClick={onBrowseFiles}>
              Browse files
            </Button>
          </div>

          <div
            className={cn(
              "mt-4 rounded-[1.25rem] border border-dashed px-4 py-8 text-center transition",
              isDragging
                ? "border-emerald-400/50 bg-emerald-500/10"
                : "border-white/15 bg-slate-950/35",
            )}
            onDragEnter={(event) => {
              event.preventDefault();
              setIsDragging(true);
            }}
            onDragOver={(event) => {
              event.preventDefault();
              event.dataTransfer.dropEffect = "copy";
              setIsDragging(true);
            }}
            onDragLeave={(event) => {
              event.preventDefault();
              setIsDragging(false);
            }}
            onDrop={(event) => {
              event.preventDefault();
              setIsDragging(false);
              onDropFiles(event.dataTransfer.files);
            }}
          >
            <div className="mx-auto flex size-12 items-center justify-center rounded-2xl border border-white/10 bg-white/5 text-slate-200">
              <UploadIcon />
            </div>
            <div className="mt-4 text-sm font-medium text-foreground">
              Drop files to stage them for Bob
            </div>
            <div className="mt-2 text-sm leading-6 text-slate-400">
              Product docs, screenshots, exported PDFs, and meeting notes all
              fit here.
            </div>
          </div>

          {attachedFiles.length > 0 ? (
            <div className="mt-4 space-y-3">
              {attachedFiles.map((file) => (
                <div
                  key={file.id}
                  className="flex items-center justify-between gap-3 rounded-2xl border border-white/8 bg-slate-950/45 px-3 py-3"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="flex size-9 items-center justify-center rounded-xl border border-white/8 bg-white/5 text-slate-200">
                      {file.name.match(/\.(png|jpg|jpeg|webp|gif)$/i) ? (
                        <ImageIcon />
                      ) : (
                        <FileTextIcon />
                      )}
                    </div>
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium text-foreground">
                        {file.name}
                      </div>
                      <div className="text-xs text-slate-400">{file.sizeLabel}</div>
                    </div>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => onRemoveFile(file.id)}
                  >
                    Remove
                  </Button>
                </div>
              ))}
            </div>
          ) : null}
        </div>

        <div className="rounded-[1.5rem] border border-white/10 bg-black/10 p-4">
          <div className="text-xs uppercase tracking-[0.22em] text-slate-400">
            Pull from repository
          </div>
          <div className="mt-2 text-sm leading-6 text-slate-300/70">
            Pick the project surfaces Bob should keep in view when the session
            starts.
          </div>
          <div className="mt-4 space-y-3">
            {experience.repoSources.map((source) => {
              const isSelected = selectedSourceIds.includes(source.id);

              return (
                <button
                  key={source.id}
                  type="button"
                  onClick={() => onToggleSource(source.id)}
                  className={cn(
                    "w-full rounded-[1.25rem] border px-4 py-4 text-left transition",
                    isSelected
                      ? "border-emerald-400/35 bg-emerald-500/10"
                      : "border-white/8 bg-slate-950/35 hover:border-white/15 hover:bg-slate-950/50",
                  )}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-sm font-medium text-foreground">
                      {source.label}
                    </div>
                    <Badge
                      className={cn(
                        "border-white/10 text-xs",
                        isSelected
                          ? "bg-emerald-500/10 text-emerald-100"
                          : "bg-white/5 text-slate-300",
                      )}
                    >
                      {source.path}
                    </Badge>
                  </div>
                  <p className="mt-2 text-sm leading-6 text-slate-300/70">
                    {source.detail}
                  </p>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <DialogFooter className="border-t border-white/10 pt-5">
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={isSubmitting}>
          {experience.confirmLabel}
        </Button>
      </DialogFooter>
    </form>
  );
}
