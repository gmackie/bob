"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { formatRelativeTime } from "~/lib/format/time";
import { useTRPC } from "~/trpc/react";

type Phase = "shape" | "plan" | "execute" | "review" | "ship";

const PHASE_COLORS: Record<
  Phase,
  { bg: string; text: string; darkBg: string; darkText: string }
> = {
  shape: {
    bg: "bg-[#F3E8FF]",
    text: "text-[#7C3AED]",
    darkBg: "dark:bg-[#2D1B4E]",
    darkText: "dark:text-[#A78BFA]",
  },
  plan: {
    bg: "bg-[#E3F2FD]",
    text: "text-[#1565C0]",
    darkBg: "dark:bg-[#162230]",
    darkText: "dark:text-[#42A5F5]",
  },
  execute: {
    bg: "bg-[#FFF3E0]",
    text: "text-[#D4850A]",
    darkBg: "dark:bg-[#2C2418]",
    darkText: "dark:text-[#E8A33C]",
  },
  review: {
    bg: "bg-[#E8F5E9]",
    text: "text-[#2D8A4E]",
    darkBg: "dark:bg-[#1B2E1D]",
    darkText: "dark:text-[#4CAF50]",
  },
  ship: {
    bg: "bg-[#F5F4F1]",
    text: "text-[#1C1B18]",
    darkBg: "dark:bg-[#232220]",
    darkText: "dark:text-[#EEEDEA]",
  },
};

function PhaseBadge({ phase }: { phase: string }) {
  const colors = PHASE_COLORS[phase as Phase] ?? PHASE_COLORS.ship;
  return (
    <span
      className={`inline-flex items-center rounded-sm px-1.5 py-0.5 font-[family-name:var(--font-dm-sans)] text-xs font-semibold uppercase tracking-wider ${colors.bg} ${colors.text} ${colors.darkBg} ${colors.darkText}`}
    >
      {phase}
    </span>
  );
}

function formatEventType(eventType: string): string {
  return eventType
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function isDelegationEvent(eventType: string): boolean {
  return eventType === "delegation_started" || eventType === "delegation_completed";
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function getEventLabel(event: LifecycleEvent): string {
  if (isDelegationEvent(event.eventType) && event.metadata?.toolName) {
    return String(event.metadata.toolName);
  }
  return formatEventType(event.eventType);
}

interface LifecycleEvent {
  id: string;
  taskRunId: string;
  eventType: string;
  phase: string;
  metadata: Record<string, unknown> | null;
  createdAt: string | Date;
}

interface LifecycleTimelineProps {
  workItemId: string;
}

const COLLAPSED_LIMIT = 15;

export function LifecycleTimeline({ workItemId }: LifecycleTimelineProps) {
  const trpc = useTRPC();
  const [expanded, setExpanded] = useState(false);
  const [expandedMetadata, setExpandedMetadata] = useState<Set<string>>(
    new Set(),
  );

  const { data: events, isLoading } = useQuery({
    ...trpc.taskRun.listLifecycleEvents.queryOptions({
      workItemId,
      limit: 50,
    }),
    staleTime: 15_000,
  });

  const toggleMetadata = (eventId: string) => {
    setExpandedMetadata((prev) => {
      const next = new Set(prev);
      if (next.has(eventId)) {
        next.delete(eventId);
      } else {
        next.add(eventId);
      }
      return next;
    });
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8 font-[family-name:var(--font-dm-sans)] text-sm text-[#8A877E] dark:text-[#6E6B64]">
        Loading lifecycle events...
      </div>
    );
  }

  if (!events || events.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-[#E3E1DC] px-4 py-6 text-center dark:border-[#2E2D2A]">
        <p className="font-[family-name:var(--font-dm-sans)] text-sm text-[#5C5A53] dark:text-[#A8A59E]">
          No lifecycle events yet
        </p>
        <p className="mt-1 font-[family-name:var(--font-dm-sans)] text-[13px] text-[#8A877E] dark:text-[#6E6B64]">
          Events are generated as this work item moves through shape, plan,
          execute, review, and ship phases.
        </p>
      </div>
    );
  }

  const visible = expanded ? events : events.slice(0, COLLAPSED_LIMIT);
  const hasMore = events.length > COLLAPSED_LIMIT;

  return (
    <div>
      <ol className="relative space-y-0">
        {visible.map((event: LifecycleEvent, index: number) => {
          const isLast = index === visible.length - 1;
          const hasMetadata =
            event.metadata &&
            Object.keys(event.metadata).length > 0;
          const isMetadataExpanded = expandedMetadata.has(event.id);

          const isDelegation = isDelegationEvent(event.eventType);
          const isError = isDelegation && event.metadata?.isError === true;
          const durationMs =
            event.eventType === "delegation_completed" && event.metadata?.durationMs != null
              ? Number(event.metadata.durationMs)
              : null;

          return (
            <li
              key={event.id}
              className={`relative flex gap-3 pb-4 ${isDelegation ? "ml-4 border-l-2 border-[#B5B2AB] pl-3 dark:border-[#6E6B64]" : ""}`}
            >
              {/* Vertical connector line */}
              {!isLast && !isDelegation && (
                <span
                  className="absolute left-[5px] top-3 bottom-0 w-px bg-[#E3E1DC] dark:bg-[#2E2D2A]"
                  aria-hidden="true"
                />
              )}

              {/* Timeline dot */}
              {!isDelegation && (
                <span
                  className="relative mt-1.5 size-[10px] shrink-0 rounded-full border-2 border-white bg-[#B5B2AB] dark:border-[#1C1B18] dark:bg-[#6E6B64]"
                  aria-hidden="true"
                />
              )}

              {/* Event content */}
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <PhaseBadge phase={event.phase} />
                  <span
                    className={`font-[family-name:var(--font-dm-sans)] text-sm ${
                      isError
                        ? "text-red-600 dark:text-red-400"
                        : "text-[#1C1B18] dark:text-[#EEEDEA]"
                    }`}
                  >
                    {getEventLabel(event)}
                  </span>
                  {durationMs != null && (
                    <span className={`font-[family-name:var(--font-jetbrains-mono)] text-xs ${isError ? "text-red-500 dark:text-red-400" : "text-[#8A877E] dark:text-[#6E6B64]"}`}>
                      {formatDuration(durationMs)}
                    </span>
                  )}
                </div>

                <p className={`mt-0.5 font-[family-name:var(--font-dm-sans)] text-[13px] ${isError ? "text-red-500 dark:text-red-400" : "text-[#8A877E] dark:text-[#6E6B64]"}`}>
                  {formatRelativeTime(event.createdAt)}
                  {isDelegation && !event.metadata?.toolName && (
                    <span className="ml-1 italic">
                      ({formatEventType(event.eventType)})
                    </span>
                  )}
                </p>

                {hasMetadata && (
                  <button
                    type="button"
                    onClick={() => toggleMetadata(event.id)}
                    className="mt-1 font-[family-name:var(--font-dm-sans)] text-xs text-[#8A877E] transition-colors hover:text-[#5C5A53] dark:text-[#6E6B64] dark:hover:text-[#A8A59E]"
                  >
                    {isMetadataExpanded ? "Hide details" : "Show details"}
                  </button>
                )}

                {hasMetadata && isMetadataExpanded && (
                  <pre className="mt-1.5 overflow-x-auto rounded-lg border border-[#E3E1DC] bg-[#F5F4F1] p-2 font-[family-name:var(--font-jetbrains-mono)] text-xs text-[#3D3B36] dark:border-[#2E2D2A] dark:bg-[#232220] dark:text-[#A8A59E]">
                    {JSON.stringify(event.metadata, null, 2)}
                  </pre>
                )}
              </div>
            </li>
          );
        })}
      </ol>

      {hasMore && !expanded && (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="mt-1 font-[family-name:var(--font-dm-sans)] text-sm text-[#8A877E] transition-colors hover:text-[#1C1B18] dark:text-[#6E6B64] dark:hover:text-[#EEEDEA]"
        >
          Show all ({events.length})
        </button>
      )}
    </div>
  );
}
