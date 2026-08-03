"use client";

import { useState } from "react";

import { useTRPC } from "~/trpc/react";
import { useMutation } from "@tanstack/react-query";

// Phase 5 M1 (OODA side, in-product): dispatch an executable Bob run from a
// thread. Calls trpc.bob.dispatch, which POSTs to Bob's public /api/v1/dispatch
// with this thread's slug/id as the correlation. When the run finishes, Bob's
// runner writes the outcome back into this thread as a note (M2 read-back), so
// the round-trip closes without any polling here.
//
// Dark until wired: if Bob dispatch env isn't configured the mutation returns
// PRECONDITION_FAILED, and if Bob's endpoint is gated off it returns FORBIDDEN —
// both surfaced inline so the failure is legible rather than silent.

const AGENT_OPTIONS = ["auto", "claude", "grok", "codex", "cursor"] as const;

export function BobDispatchBar({
  threadSlug,
  threadId,
  onClose,
}: {
  threadSlug: string;
  threadId: string;
  onClose: () => void;
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [agent, setAgent] = useState<(typeof AGENT_OPTIONS)[number]>("auto");

  const trpc = useTRPC();
  const dispatchMutation = useMutation(trpc.bob.dispatch.mutationOptions());

  const submit = () => {
    const trimmed = title.trim();
    if (!trimmed) return;
    dispatchMutation.mutate({
      threadSlug,
      threadId,
      title: trimmed,
      description: description.trim() || undefined,
      agentType: agent === "auto" ? undefined : agent,
    });
  };

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-primary/40 bg-[#2E2A1A] px-4 py-2">
      <span className="shrink-0 font-mono text-xs text-primary">
        Dispatch to Bob:
      </span>
      <input
        type="text"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !dispatchMutation.isPending) submit();
        }}
        placeholder="What should Bob build?"
        aria-label="Bob run title"
        className="min-w-0 flex-1 basis-56 rounded-[3px] border border-primary/30 bg-card px-2 py-1 font-mono text-xs text-foreground placeholder-subtle outline-none focus:border-primary"
      />
      <input
        type="text"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        placeholder="Details (optional)"
        aria-label="Bob run description"
        className="min-w-0 flex-1 basis-40 rounded-[3px] border border-primary/30 bg-card px-2 py-1 font-mono text-xs text-foreground placeholder-subtle outline-none focus:border-primary"
      />
      <select
        value={agent}
        onChange={(e) =>
          setAgent(e.target.value as (typeof AGENT_OPTIONS)[number])
        }
        aria-label="Agent"
        className="shrink-0 rounded-[3px] border border-primary/30 bg-card px-2 py-1 font-mono text-xs text-foreground outline-none"
      >
        {AGENT_OPTIONS.map((a) => (
          <option key={a} value={a}>
            {a}
          </option>
        ))}
      </select>
      <button
        onClick={submit}
        disabled={!title.trim() || dispatchMutation.isPending}
        className="shrink-0 rounded-[3px] bg-primary px-3 py-1 font-mono text-xs font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-50"
      >
        {dispatchMutation.isPending ? "Dispatching..." : "Dispatch"}
      </button>
      {/* Result / error line: aria-live so the outcome is announced. */}
      <span
        role="status"
        aria-live="polite"
        className="basis-full font-mono text-xs"
      >
        {dispatchMutation.isSuccess ? (
          <span className="text-green-400">
            Dispatched {dispatchMutation.data.identifier} —{" "}
            {dispatchMutation.data.status}. Bob will post the outcome back to
            this thread.
          </span>
        ) : dispatchMutation.isError ? (
          <span className="text-red-400">
            {dispatchMutation.error.message}
          </span>
        ) : (
          <span className="text-subtle">
            Runs in Bob; the result returns here as a thread note.
          </span>
        )}
      </span>
      <button
        onClick={onClose}
        className="ml-auto shrink-0 font-mono text-xs text-subtle hover:text-muted-foreground"
      >
        Cancel
      </button>
    </div>
  );
}
