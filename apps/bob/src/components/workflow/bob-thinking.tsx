"use client";

import { useQuery } from "@tanstack/react-query";

import { cn } from "@gmacko/core/ui";

import { useTRPC } from "~/trpc/react";
import { getBobThinkingSessionHref } from "./bob-thinking-model";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ThinkingState =
  | "idle"
  | "thinking"
  | "shaping"
  | "planning"
  | "executing"
  | "reviewing";

interface BobThinkingProps {
  workItemId: string;
  sessionId?: string | null;
  workspaceId?: string | null;
}

// ---------------------------------------------------------------------------
// State label map
// ---------------------------------------------------------------------------

const STATE_LABELS: Record<Exclude<ThinkingState, "idle">, string> = {
  thinking: "Bob is analyzing\u2026",
  shaping: "Bob is defining requirements\u2026",
  planning: "Bob is creating tasks\u2026",
  executing: "Bob is working on tasks\u2026",
  reviewing: "Bob is reviewing changes\u2026",
};

// ---------------------------------------------------------------------------
// Detection logic: map session data -> ThinkingState
// ---------------------------------------------------------------------------

function deriveThinkingState(session: {
  status: string | null;
  sessionType: string | null;
  workflowStatus: string | null;
}): ThinkingState {
  const { status, sessionType, workflowStatus } = session;

  // Not actively running -> idle
  if (status !== "running") return "idle";

  // Running + awaiting input is a special display handled separately, but
  // the component still shows itself (the banner text will include the prompt).
  if (workflowStatus === "awaiting_input") return "thinking";

  // Running + planning session type -> shaping
  if (sessionType === "planning") return "shaping";

  // Running + workflow indicates review
  if (workflowStatus === "awaiting_review") return "reviewing";

  // Default running state
  return "executing";
}

// ---------------------------------------------------------------------------
// Animated dots component
// ---------------------------------------------------------------------------

function AnimatedDots() {
  return (
    <span className="inline-flex items-center gap-0.5" aria-hidden>
      <span className="h-1.5 w-1.5 rounded-full bg-primary animate-bounce [animation-delay:0ms]" />
      <span className="h-1.5 w-1.5 rounded-full bg-primary animate-bounce [animation-delay:150ms]" />
      <span className="h-1.5 w-1.5 rounded-full bg-primary animate-bounce [animation-delay:300ms]" />
    </span>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function BobThinking({
  workItemId: _workItemId,
  sessionId,
  workspaceId,
}: BobThinkingProps) {
  const trpc = useTRPC();

  const { data: session } = useQuery(
    trpc.session.get.queryOptions(
      { id: sessionId! },
      {
        enabled: Boolean(sessionId),
        refetchInterval: 3_000,
      },
    ),
  );
  const sessionRecord = session as unknown as {
    status?: string | null;
    sessionType?: string | null;
    workflowStatus?: string | null;
    awaitingInputQuestion?: string | null;
    workspaceId?: string | null;
  } | null | undefined;

  // Derive thinking state
  const thinkingState: ThinkingState = !sessionId
    ? "idle"
    : sessionRecord
      ? deriveThinkingState({
          status: sessionRecord.status ?? null,
          sessionType: sessionRecord.sessionType ?? null,
          workflowStatus: sessionRecord.workflowStatus ?? null,
        })
      : "idle";

  // Awaiting input details
  const isAwaitingInput =
    sessionRecord &&
    sessionRecord.status === "running" &&
    sessionRecord.workflowStatus === "awaiting_input";
  const awaitingQuestion = isAwaitingInput
    ? sessionRecord.awaitingInputQuestion ?? null
    : null;
  const sessionWorkspaceId = workspaceId ?? sessionRecord?.workspaceId;

  // Don't render when idle
  if (thinkingState === "idle") return null;

  const label =
    isAwaitingInput && awaitingQuestion
      ? awaitingQuestion
      : STATE_LABELS[thinkingState];

  return (
    <div
      className={cn(
        "flex w-full items-center gap-3 rounded-xl border px-4 py-3",
        "bg-primary/5 border-primary/20",
        "transition-all duration-200",
        "animate-in fade-in slide-in-from-top-1",
      )}
    >
      {/* Left: animated dots */}
      <AnimatedDots />

      {/* Center: status text */}
      <span className="flex-1 text-sm text-foreground">{label}</span>

      {/* Right: view session link */}
      {sessionId && (
        <a
          href={getBobThinkingSessionHref(sessionId, sessionWorkspaceId)}
          className="text-sm font-medium text-primary hover:text-primary/80 transition-colors whitespace-nowrap"
        >
          View session &rarr;
        </a>
      )}
    </div>
  );
}
