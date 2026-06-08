"use client";

import { useMemo } from "react";
import Link from "next/link";

import { Badge } from "@gmacko/core/ui/badge";

import { AwaitingInputCard } from "~/app/(dashboard)/chat/_components/awaiting-input-card";
import { InputComposer } from "~/app/(dashboard)/chat/_components/input-composer";
import { MessageStream } from "~/app/(dashboard)/chat/_components/message-stream";
import { useChatSession } from "~/hooks/use-chat-session";
import { formatPlanningSessionStatus } from "./planning-dashboard-model";
import { getPlanningDashboardHref } from "./planning-shell-model";

interface PlanningSessionWorkspaceProps {
  session: {
    id: string;
    title?: string | null;
    status?: string | null;
    workingDirectory?: string | null;
    planningProjectName?: string | null;
    planningSessionType?: string | null;
    workspaceId?: string | null;
  };
  drafts: Array<{
    id: string;
    title: string;
    status?: string | null;
    priority?: string | null;
    description?: string | null;
  }>;
}

const STATUS_VARIANT: Record<string, "default" | "slate" | "blue" | "amber" | "emerald" | "rose"> = {
  awaiting_input: "amber",
  completed: "emerald",
  failed: "rose",
  pending: "amber",
  provisioning: "amber",
  running: "blue",
  starting: "blue",
  stopped: "slate",
};

function formatDraftMeta(draft: PlanningSessionWorkspaceProps["drafts"][number]): string {
  return [draft.priority, draft.status].filter(Boolean).join(" · ") || "Draft";
}

export function PlanningSessionWorkspace({
  session,
  drafts,
}: PlanningSessionWorkspaceProps) {
  const {
    canSend,
    events,
    isConnected,
    resolveInput,
    sendMessage,
    sessionStatus,
    workflowState,
  } = useChatSession({ sessionId: session.id, enabled: true });

  const isReadOnly = session.status === "stopped" || session.status === "completed";
  const isAwaitingInput = workflowState?.workflowStatus === "awaiting_input";
  const sessionLabel = useMemo(
    () => session.title ?? session.planningProjectName ?? "Planning session",
    [session.planningProjectName, session.title],
  );

  return (
    <div className="grid min-h-[calc(100vh-16rem)] gap-5 xl:grid-cols-[minmax(0,1fr)_22rem]">
      <section className="flex min-h-[36rem] flex-col overflow-hidden rounded-2xl border border-border bg-card">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-5 py-4">
          <div className="min-w-0">
            <h2 className="truncate font-display text-lg font-semibold text-foreground">
              {sessionLabel}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {session.workingDirectory ?? "/"} · {isConnected ? "Connected" : "Connecting"}
            </p>
          </div>
          <Badge variant={STATUS_VARIANT[sessionStatus] ?? STATUS_VARIANT[session.status ?? ""] ?? "slate"}>
            {formatPlanningSessionStatus(sessionStatus ?? session.status)}
          </Badge>
        </div>

        {workflowState?.awaitingInput ? (
          <div className="border-b border-border p-4">
            <AwaitingInputCard
              question={workflowState.awaitingInput.question}
              options={workflowState.awaitingInput.options}
              defaultAction={workflowState.awaitingInput.defaultAction}
              expiresAt={workflowState.awaitingInput.expiresAt}
              onResolve={resolveInput}
              isResolving={false}
            />
          </div>
        ) : null}

        <div className="min-h-0 flex-1 overflow-y-auto">
          <MessageStream
            sessionId={session.id}
            events={events}
            isConnected={isConnected}
          />
        </div>

        {!isReadOnly ? (
          <div className="border-t border-border">
            <InputComposer
              onSend={sendMessage}
              disabled={!canSend || isAwaitingInput}
              sessionId={session.id}
              placeholder={
                !isConnected
                  ? "Connecting..."
                  : isAwaitingInput
                    ? "Resolve input prompt above"
                    : "Send a planning follow-up..."
              }
            />
          </div>
        ) : null}
      </section>

      <aside className="rounded-2xl border border-border bg-card p-5">
        <div className="flex items-center justify-between gap-3">
          <h2 className="font-display text-sm font-semibold text-foreground">
            Draft Tasks
          </h2>
          <span className="text-xs font-semibold tabular-nums text-muted-foreground">
            {drafts.length}
          </span>
        </div>

        {drafts.length === 0 ? (
          <p className="mt-4 text-sm text-muted-foreground">
            No draft tasks have been produced by this session yet.
          </p>
        ) : (
          <div className="mt-4 flex flex-col gap-2">
            {drafts.map((draft) => (
              <div
                key={draft.id}
                className="rounded-lg border border-border/70 bg-background/40 px-3 py-2.5"
              >
                <p className="text-sm font-medium text-foreground">
                  {draft.title}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {formatDraftMeta(draft)}
                </p>
                {draft.description ? (
                  <p className="mt-2 line-clamp-3 text-xs text-muted-foreground">
                    {draft.description}
                  </p>
                ) : null}
              </div>
            ))}
          </div>
        )}

        <Link
          href={getPlanningDashboardHref(session.workspaceId)}
          className="mt-5 inline-flex text-xs font-medium text-primary hover:text-primary/80"
        >
          Back to recent sessions
        </Link>
      </aside>
    </div>
  );
}
