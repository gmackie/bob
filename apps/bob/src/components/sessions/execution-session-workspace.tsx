"use client";

import Link from "next/link";

import { Badge } from "@gmacko/core/ui/badge";

import { AwaitingInputCard } from "~/app/(dashboard)/chat/_components/awaiting-input-card";
import { InputComposer } from "~/app/(dashboard)/chat/_components/input-composer";
import { MessageStream } from "~/app/(dashboard)/chat/_components/message-stream";
import { useChatSession } from "~/hooks/use-chat-session";
import { getExecutionSessionLinkedTaskHref } from "./execution-session-workspace-model";

interface ExecutionSessionWorkspaceProps {
  session: {
    id: string;
    title?: string | null;
    status?: string | null;
    agentType?: string | null;
    workingDirectory?: string | null;
    workspaceId?: string | null;
    workItemId?: string | null;
    workItemIdentifier?: string | null;
    linkedTask?: {
      id?: string | null;
      identifier?: string | null;
      url?: string | null;
    } | null;
  };
}

const STATUS_VARIANT: Record<string, "default" | "slate" | "blue" | "amber" | "emerald" | "rose"> = {
  awaiting_input: "amber",
  completed: "emerald",
  error: "rose",
  failed: "rose",
  idle: "slate",
  provisioning: "amber",
  running: "blue",
  starting: "blue",
  stopped: "slate",
  stopping: "amber",
};

function formatSessionStatus(status?: string | null): string {
  if (!status) return "Unknown";
  return status.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function ExecutionSessionWorkspace({
  session,
}: ExecutionSessionWorkspaceProps) {
  const {
    canSend,
    events,
    isConnected,
    resolveInput,
    sendMessage,
    sessionStatus,
    workflowState,
  } = useChatSession({ sessionId: session.id, enabled: true });

  const effectiveStatus = sessionStatus ?? session.status ?? "stopped";
  const isAwaitingInput = workflowState?.workflowStatus === "awaiting_input";
  const isReadOnly =
    effectiveStatus === "stopped" ||
    effectiveStatus === "completed" ||
    effectiveStatus === "error";
  const linkedTaskHref = getExecutionSessionLinkedTaskHref({
    workItemId: session.workItemId,
    linkedTaskUrl: session.linkedTask?.url,
    workspaceId: session.workspaceId,
  });
  const linkedTaskLabel =
    session.linkedTask?.identifier ??
    session.workItemIdentifier ??
    session.workItemId ??
    null;

  return (
    <div className="grid min-h-[calc(100vh-10rem)] gap-5 xl:grid-cols-[minmax(0,1fr)_22rem]">
      <section className="flex min-h-[40rem] flex-col overflow-hidden rounded-2xl border border-border bg-card">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-5 py-4">
          <div className="min-w-0">
            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Execution Session
            </div>
            <h1 className="mt-1 truncate font-display text-xl font-semibold text-foreground">
              {session.title ?? `Session ${session.id.slice(0, 8)}`}
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {session.agentType ?? "Agent"} · {session.workingDirectory ?? "/"} ·{" "}
              {isConnected ? "Connected" : "Connecting"}
            </p>
          </div>
          <Badge variant={STATUS_VARIANT[effectiveStatus] ?? "slate"}>
            {formatSessionStatus(effectiveStatus)}
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
                    : "Send a follow-up..."
              }
            />
          </div>
        ) : null}
      </section>

      <aside className="rounded-2xl border border-border bg-card p-5">
        <h2 className="font-display text-sm font-semibold text-foreground">
          Session Details
        </h2>
        <dl className="mt-4 space-y-3 text-sm">
          <div>
            <dt className="text-xs uppercase tracking-wide text-muted-foreground">
              Session ID
            </dt>
            <dd className="mt-1 break-all font-mono text-xs text-foreground">
              {session.id}
            </dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-muted-foreground">
              Agent
            </dt>
            <dd className="mt-1 text-foreground">{session.agentType ?? "Unknown"}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-muted-foreground">
              Directory
            </dt>
            <dd className="mt-1 break-all font-mono text-xs text-foreground">
              {session.workingDirectory ?? "/"}
            </dd>
          </div>
          {linkedTaskHref && linkedTaskLabel ? (
            <div>
              <dt className="text-xs uppercase tracking-wide text-muted-foreground">
                Linked task
              </dt>
              <dd className="mt-1">
                <Link
                  href={linkedTaskHref}
                  className="text-sm font-medium text-primary hover:text-primary/80"
                >
                  {linkedTaskLabel}
                </Link>
              </dd>
            </div>
          ) : null}
        </dl>
      </aside>
    </div>
  );
}
