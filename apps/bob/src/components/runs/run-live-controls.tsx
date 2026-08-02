"use client";

import { cn } from "@gmacko/core/ui";
import { Button } from "@gmacko/core/ui/button";

import { AwaitingInputCard } from "~/app/(dashboard)/chat/_components/awaiting-input-card";
import { InputComposer } from "~/app/(dashboard)/chat/_components/input-composer";
import { useChatSession } from "~/hooks/use-chat-session";

// Live controls for an in-progress run, composed from the same hook + panels
// the /sessions surface uses: Stop, the approve/answer banner when the run is
// blocked on a human, and a steering input for follow-ups. The run-detail page
// mounts this only for active runs that have a session, so a terminal run never
// opens a socket; if the run goes terminal while mounted, this self-hides.
export function RunLiveControls({ sessionId }: { sessionId: string }) {
  const {
    canSend,
    isConnected,
    isResolving,
    resolveInput,
    sendMessage,
    sessionStatus,
    stopSession,
    workflowState,
  } = useChatSession({ sessionId, enabled: true });

  const effectiveStatus = sessionStatus ?? "running";
  const isAwaitingInput = workflowState?.workflowStatus === "awaiting_input";
  const isReadOnly =
    effectiveStatus === "stopped" ||
    effectiveStatus === "completed" ||
    effectiveStatus === "error";
  const isStopping = effectiveStatus === "stopping";

  // Nothing live to act on — the run went terminal after we mounted, and there's
  // no pending prompt. Render nothing rather than a dead control bar.
  if (isReadOnly && !workflowState?.awaitingInput) return null;

  return (
    <section className="rounded-2xl border border-border bg-card">
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span
            className={cn(
              "size-2 rounded-full",
              isConnected ? "bg-emerald-500 animate-pulse" : "bg-neutral-400",
            )}
            aria-hidden="true"
          />
          {isConnected ? "Live" : "Connecting…"}
        </div>
        {!isReadOnly ? (
          <Button
            variant="destructive"
            size="sm"
            onClick={stopSession}
            disabled={!isConnected || isStopping}
          >
            {isStopping ? "Stopping…" : "Stop"}
          </Button>
        ) : null}
      </div>

      {workflowState?.awaitingInput ? (
        <div className="border-t border-border p-4">
          <AwaitingInputCard
            question={workflowState.awaitingInput.question}
            options={workflowState.awaitingInput.options}
            defaultAction={workflowState.awaitingInput.defaultAction}
            expiresAt={workflowState.awaitingInput.expiresAt}
            onResolve={resolveInput}
            isResolving={isResolving}
          />
        </div>
      ) : null}

      {!isReadOnly ? (
        <div className="border-t border-border">
          <InputComposer
            onSend={sendMessage}
            disabled={!canSend || isAwaitingInput}
            sessionId={sessionId}
            placeholder={
              !isConnected
                ? "Connecting..."
                : isAwaitingInput
                  ? "Resolve the prompt above"
                  : "Send a follow-up / steer…"
            }
          />
        </div>
      ) : null}
    </section>
  );
}
