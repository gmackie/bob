"use client";

import { useState } from "react";

import { useTRPC } from "~/trpc/react";
import { useMutation } from "@tanstack/react-query";

// Phase 3 — "Make it a project" (rare, project-only). Turns a discussion into a
// real Bob (linear-clone) project: creates the project, seeds a backlog of
// tasks, and optionally scaffolds a new app via create-gmacko-app as an
// executable Bob dispatch. The thread slug/id ride along so any dispatched
// scaffold reports its outcome back into this thread (M2 read-back).
//
// Dark until wired: createProject returns PRECONDITION_FAILED when Bob env is
// unset and FORBIDDEN when Bob's dispatch is gated off — both shown inline.

export function BobDispatchBar({
  threadSlug,
  threadId,
  onClose,
}: {
  threadSlug: string;
  threadId: string;
  onClose: () => void;
}) {
  const [name, setName] = useState("");
  const [tasksText, setTasksText] = useState("");
  const [scaffold, setScaffold] = useState(false);

  const trpc = useTRPC();
  const createMutation = useMutation(trpc.bob.createProject.mutationOptions());

  const submit = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    const tasks = tasksText
      .split(/[\n,]/)
      .map((t) => t.trim())
      .filter(Boolean)
      .slice(0, 20);
    createMutation.mutate({
      threadSlug,
      threadId,
      name: trimmed,
      tasks: tasks.length ? tasks : undefined,
      scaffold,
    });
  };

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-[#D4A04A]/40 bg-[#2E2A1A] px-4 py-2">
      <span className="shrink-0 font-mono text-xs text-[#D4A04A]">
        Make it a project:
      </span>
      <input
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !createMutation.isPending) submit();
        }}
        placeholder="Project name"
        aria-label="Project name"
        className="min-w-0 flex-1 basis-44 rounded-[3px] border border-[#D4A04A]/30 bg-[#1A1A1E] px-2 py-1 font-mono text-xs text-[#E8E4DF] placeholder-[#5A5855] outline-none focus:border-[#D4A04A]"
      />
      <input
        type="text"
        value={tasksText}
        onChange={(e) => setTasksText(e.target.value)}
        placeholder="Seed tasks (comma-separated, optional)"
        aria-label="Seed tasks"
        className="min-w-0 flex-1 basis-52 rounded-[3px] border border-[#D4A04A]/30 bg-[#1A1A1E] px-2 py-1 font-mono text-xs text-[#E8E4DF] placeholder-[#5A5855] outline-none focus:border-[#D4A04A]"
      />
      <label className="flex shrink-0 items-center gap-1.5 font-mono text-xs text-[#8A8580]">
        <input
          type="checkbox"
          checked={scaffold}
          onChange={(e) => setScaffold(e.target.checked)}
          className="accent-[#D4A04A]"
        />
        scaffold app
      </label>
      <button
        onClick={submit}
        disabled={!name.trim() || createMutation.isPending}
        className="shrink-0 rounded-[3px] bg-[#D4A04A] px-3 py-1 font-mono text-xs font-medium text-[#111113] transition-opacity hover:opacity-90 disabled:opacity-50"
      >
        {createMutation.isPending ? "Creating…" : "Create project"}
      </button>
      {/* Result / error line. */}
      <span
        role="status"
        aria-live="polite"
        className="basis-full font-mono text-xs"
      >
        {createMutation.isSuccess ? (
          <span className="text-[#6BbF59]">
            Created project {createMutation.data.key} with{" "}
            {createMutation.data.workItems.length} task
            {createMutation.data.workItems.length === 1 ? "" : "s"}
            {createMutation.data.scaffold
              ? ` — scaffold dispatched (${createMutation.data.scaffold.identifier})`
              : scaffold
                ? " — scaffold could not be dispatched"
                : ""}
            .
          </span>
        ) : createMutation.isError ? (
          <span className="text-[#E06B6B]">{createMutation.error.message}</span>
        ) : (
          <span className="text-[#5A5855]">
            Creates a Bob project + backlog. Optionally scaffolds a new app via
            create-gmacko-app.
          </span>
        )}
      </span>
      <button
        onClick={onClose}
        className="ml-auto shrink-0 font-mono text-xs text-[#5A5855] hover:text-[#8A8580]"
      >
        Cancel
      </button>
    </div>
  );
}
