"use client";

import { useState } from "react";
import {
  useExplorationList,
  useStartExploration,
  useRespondToCheckIn,
} from "@/rpc/hooks";

/* ------------------------------------------------------------------ */
/* Client-side types matching the JSON wire format                     */
/* (Effect Option/Schema types serialize to plain values over JSON)    */
/* ------------------------------------------------------------------ */

type ExplorationDirection = "continue" | "go_deeper" | "redirect" | "stop";

interface ExplorationCheckInWire {
  id: string;
  explorationId: string;
  summary: string;
  suggestedDirections: string[];
  articlesWritten: string[];
  depth: number;
  status: string;
}

interface ExplorationSummaryWire {
  id: string;
  threadId: string;
  topic: string;
  status: "running" | "paused" | "completed" | "awaiting_input";
  depth: number;
  articlesWrittenCount: number;
  lastCheckIn?: ExplorationCheckInWire;
}

/* ------------------------------------------------------------------ */
/* Status badge                                                        */
/* ------------------------------------------------------------------ */

const statusColors: Record<string, { bg: string; text: string }> = {
  running: { bg: "var(--color-success)", text: "#000" },
  paused: { bg: "var(--color-warning)", text: "#000" },
  completed: { bg: "var(--color-text-muted)", text: "#fff" },
  awaiting_input: { bg: "var(--color-accent)", text: "#000" },
};

function StatusBadge({ status }: { status: string }) {
  const c = statusColors[status] ?? statusColors.running!;
  return (
    <span
      className="inline-block rounded-full px-2.5 py-0.5 text-xs font-medium"
      style={{ backgroundColor: c.bg, color: c.text }}
    >
      {status.replace("_", " ")}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Start exploration form                                              */
/* ------------------------------------------------------------------ */

function StartForm() {
  const [topic, setTopic] = useState("");
  const [maxDepth, setMaxDepth] = useState(5);
  const startMutation = useStartExploration();

  const handleStart = () => {
    if (!topic.trim()) return;
    startMutation.mutate({
      // These UUIDs would normally come from the active thread/branch context.
      // For the explore page we pass placeholder IDs; the server creates a new
      // exploration thread automatically.
      threadId: crypto.randomUUID(),
      branchId: crypto.randomUUID(),
      topic: topic.trim(),
      maxDepth,
    });
    setTopic("");
  };

  return (
    <div className="mb-8 rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-5">
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">
        Start Exploration
      </h2>
      <div className="flex items-end gap-3">
        <div className="flex-1">
          <label className="mb-1 block text-xs text-[var(--color-text-muted)]">
            Topic
          </label>
          <input
            type="text"
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            placeholder="e.g. Transformer attention mechanisms"
            className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm text-[var(--color-text)] placeholder:text-[var(--color-text-muted)] focus:border-[var(--color-accent)] focus:outline-none"
            onKeyDown={(e) => {
              if (e.key === "Enter") handleStart();
            }}
          />
        </div>
        <div className="w-24">
          <label className="mb-1 block text-xs text-[var(--color-text-muted)]">
            Max Depth
          </label>
          <input
            type="number"
            min={1}
            max={20}
            value={maxDepth}
            onChange={(e) => setMaxDepth(Number(e.target.value))}
            className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm text-[var(--color-text)] focus:border-[var(--color-accent)] focus:outline-none"
          />
        </div>
        <button
          onClick={handleStart}
          disabled={!topic.trim() || startMutation.isPending}
          className="rounded-lg bg-[var(--color-accent)] px-5 py-2 text-sm font-medium text-[var(--color-bg)] disabled:opacity-50"
        >
          {startMutation.isPending ? "Starting..." : "Explore"}
        </button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Check-in card                                                       */
/* ------------------------------------------------------------------ */

function CheckInCard({ exploration }: { exploration: ExplorationSummaryWire }) {
  const checkIn = exploration.lastCheckIn;
  const respondMutation = useRespondToCheckIn();
  const [redirectTopic, setRedirectTopic] = useState("");
  const [showRedirect, setShowRedirect] = useState(false);

  if (!checkIn) return null;

  const respond = (direction: ExplorationDirection, topic?: string) => {
    respondMutation.mutate({
      explorationId: exploration.id,
      checkInId: checkIn.id,
      direction,
      ...(topic ? { redirectTopic: topic } : {}),
    });
    setShowRedirect(false);
    setRedirectTopic("");
  };

  return (
    <div className="mt-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-tertiary)] p-4">
      <p className="mb-3 text-sm text-[var(--color-text)]">{checkIn.summary}</p>

      {checkIn.suggestedDirections.length > 0 && (
        <div className="mb-3">
          <span className="mb-1 block text-xs text-[var(--color-text-muted)]">
            Suggested directions
          </span>
          <div className="flex flex-wrap gap-2">
            {checkIn.suggestedDirections.map((dir, i) => (
              <span
                key={i}
                className="rounded-full border border-[var(--color-accent)]/30 bg-[var(--color-accent)]/10 px-3 py-1 text-xs text-[var(--color-accent)]"
              >
                {dir}
              </span>
            ))}
          </div>
        </div>
      )}

      {checkIn.articlesWritten.length > 0 && (
        <div className="mb-3">
          <span className="mb-1 block text-xs text-[var(--color-text-muted)]">
            Articles written at this depth
          </span>
          <div className="flex flex-wrap gap-2">
            {checkIn.articlesWritten.map((article, i) => (
              <span
                key={i}
                className="rounded border border-[var(--color-border)] bg-[var(--color-bg-secondary)] px-2 py-0.5 text-xs text-[var(--color-text)]"
              >
                {article}
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={() => respond("continue")}
          disabled={respondMutation.isPending}
          className="rounded-lg bg-[var(--color-accent)] px-3 py-1.5 text-xs font-medium text-[var(--color-bg)] disabled:opacity-50"
        >
          Continue
        </button>
        <button
          onClick={() => respond("go_deeper")}
          disabled={respondMutation.isPending}
          className="rounded-lg border border-[var(--color-accent)] px-3 py-1.5 text-xs font-medium text-[var(--color-accent)] disabled:opacity-50"
        >
          Go Deeper
        </button>
        <button
          onClick={() => setShowRedirect(!showRedirect)}
          disabled={respondMutation.isPending}
          className="rounded-lg border border-[var(--color-border)] px-3 py-1.5 text-xs font-medium text-[var(--color-text)] disabled:opacity-50"
        >
          Redirect
        </button>
        <button
          onClick={() => respond("stop")}
          disabled={respondMutation.isPending}
          className="rounded-lg border border-[var(--color-border)] px-3 py-1.5 text-xs font-medium text-[var(--color-text-muted)] disabled:opacity-50"
        >
          Stop
        </button>
      </div>

      {showRedirect && (
        <div className="mt-2 flex gap-2">
          <input
            type="text"
            value={redirectTopic}
            onChange={(e) => setRedirectTopic(e.target.value)}
            placeholder="New direction..."
            className="flex-1 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-1.5 text-xs text-[var(--color-text)] placeholder:text-[var(--color-text-muted)] focus:border-[var(--color-accent)] focus:outline-none"
            onKeyDown={(e) => {
              if (e.key === "Enter" && redirectTopic.trim()) {
                respond("redirect", redirectTopic.trim());
              }
            }}
          />
          <button
            onClick={() => {
              if (redirectTopic.trim()) respond("redirect", redirectTopic.trim());
            }}
            disabled={!redirectTopic.trim() || respondMutation.isPending}
            className="rounded-lg bg-[var(--color-accent)] px-3 py-1.5 text-xs font-medium text-[var(--color-bg)] disabled:opacity-50"
          >
            Go
          </button>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Exploration card                                                    */
/* ------------------------------------------------------------------ */

function ExplorationCard({ exploration }: { exploration: ExplorationSummaryWire }) {
  const isAwaiting = exploration.status === "awaiting_input";

  return (
    <div
      className={`rounded-xl border p-5 ${
        isAwaiting
          ? "border-[var(--color-accent)]/40 bg-[var(--color-bg-secondary)]"
          : "border-[var(--color-border)] bg-[var(--color-bg-secondary)]"
      }`}
    >
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <h3 className="text-base font-semibold text-[var(--color-text)]">
            {exploration.topic}
          </h3>
          <div className="mt-1 flex items-center gap-3 text-xs text-[var(--color-text-muted)]">
            <span>Depth: {exploration.depth}</span>
            <span>Articles: {exploration.articlesWrittenCount}</span>
          </div>
        </div>
        <StatusBadge status={exploration.status} />
      </div>

      {isAwaiting && <CheckInCard exploration={exploration} />}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */

export default function ExplorePage() {
  const explorationsQuery = useExplorationList();
  const explorations = (explorationsQuery.data ?? []) as ExplorationSummaryWire[];

  const awaiting = explorations.filter((e) => e.status === "awaiting_input");
  const active = explorations.filter(
    (e) => e.status === "running" || e.status === "paused",
  );
  const completed = explorations.filter((e) => e.status === "completed");

  return (
    <div className="mx-auto max-w-3xl p-6">
      <h1 className="mb-6 text-2xl font-bold text-[var(--color-text)]">
        Explorations
      </h1>

      <StartForm />

      {explorationsQuery.isLoading && (
        <p className="text-sm text-[var(--color-text-muted)]">Loading...</p>
      )}

      {awaiting.length > 0 && (
        <section className="mb-6">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-[var(--color-accent)]">
            Awaiting Input
          </h2>
          <div className="flex flex-col gap-4">
            {awaiting.map((e) => (
              <ExplorationCard key={e.id} exploration={e} />
            ))}
          </div>
        </section>
      )}

      {active.length > 0 && (
        <section className="mb-6">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">
            Active
          </h2>
          <div className="flex flex-col gap-4">
            {active.map((e) => (
              <ExplorationCard key={e.id} exploration={e} />
            ))}
          </div>
        </section>
      )}

      {completed.length > 0 && (
        <section className="mb-6">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">
            Completed
          </h2>
          <div className="flex flex-col gap-4">
            {completed.map((e) => (
              <ExplorationCard key={e.id} exploration={e} />
            ))}
          </div>
        </section>
      )}

      {!explorationsQuery.isLoading && explorations.length === 0 && (
        <p className="text-center text-sm text-[var(--color-text-muted)]">
          No explorations yet. Start one above.
        </p>
      )}
    </div>
  );
}
