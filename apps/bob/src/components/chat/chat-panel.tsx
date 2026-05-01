"use client";

import Link from "next/link";
import { Cross1Icon, ExternalLinkIcon } from "@radix-ui/react-icons";

import { cn } from "@gmacko/core/ui";

import { MessageStream } from "~/app/(dashboard)/chat/_components/message-stream";
import { InputComposer } from "~/app/(dashboard)/chat/_components/input-composer";
import { AwaitingInputCard } from "~/app/(dashboard)/chat/_components/awaiting-input-card";
import { useChatSession } from "~/hooks/use-chat-session";

import { DraftPanel } from "~/components/planning/draft-panel";

import { useChatPanel } from "./chat-panel-provider";

const PANEL_WIDTH = 500;

export function ChatPanel() {
  const { isOpen, sessionId, contextLabel, closePanel } = useChatPanel();

  const {
    events,
    sendMessage,
    stopSession,
    resolveInput,
    workflowState,
    sessionData,
    sessionStatus,
    isConnected,
    canSend,
  } = useChatSession({ sessionId, enabled: isOpen });

  if (!isOpen) return null;

  const isAwaitingInput = workflowState?.workflowStatus === "awaiting_input";
  const isPlanningSession = sessionData?.sessionType === "planning";
  const title = sessionData?.title ?? (sessionId ? `Session ${sessionId.slice(0, 8)}` : "Chat");

  return (
    <aside
      className="fixed inset-y-0 right-0 z-40 flex flex-col border-l border-border bg-popover shadow-lg"
      style={{ width: PANEL_WIDTH }}
    >
      {/* Header */}
      <div className="flex h-12 items-center justify-between border-b border-border px-4">
        <div className="flex items-center gap-2 min-w-0">
          <div
            className={cn(
              "size-2 rounded-full",
              sessionStatus === "running" || sessionStatus === "idle"
                ? "bg-emerald-500"
                : sessionStatus === "error"
                  ? "bg-rose-500"
                  : "bg-muted-foreground",
            )}
          />
          <span className="truncate text-sm font-medium text-foreground">
            {contextLabel ?? title}
          </span>
        </div>
        <div className="flex items-center gap-1">
          {sessionId && (
            <Link
              href={`/chat?session=${sessionId}`}
              className="rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              title="Open full page"
            >
              <ExternalLinkIcon className="size-3.5" />
            </Link>
          )}
          <button
            onClick={closePanel}
            className="rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            title="Close panel"
          >
            <Cross1Icon className="size-3.5" />
          </button>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto">
        {workflowState?.awaitingInput && (
          <div className="border-b border-border p-3">
            <AwaitingInputCard
              question={workflowState.awaitingInput.question}
              options={workflowState.awaitingInput.options}
              defaultAction={workflowState.awaitingInput.defaultAction}
              expiresAt={workflowState.awaitingInput.expiresAt}
              onResolve={resolveInput}
              isResolving={false}
            />
          </div>
        )}

        {sessionId ? (
          <MessageStream
            sessionId={sessionId}
            events={events}
            isConnected={isConnected}
          />
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            No active session
          </div>
        )}
      </div>

      {/* Draft panel for planning sessions */}
      {isPlanningSession && sessionId && (
        <div className="border-t border-border px-3 py-3">
          <div className="mb-2 text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
            Draft Tasks
          </div>
          <DraftPanel sessionId={sessionId} />
        </div>
      )}

      {/* Input */}
      <div className="border-t border-border">
        <InputComposer
          onSend={sendMessage}
          disabled={!canSend || isAwaitingInput}
          sessionId={sessionId ?? undefined}
          placeholder={
            !sessionId
              ? "No session"
              : !isConnected
                ? "Connecting..."
                : isAwaitingInput
                  ? "Resolve input prompt above"
                  : "Type a message..."
          }
        />
      </div>
    </aside>
  );
}
