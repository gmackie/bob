"use client";

import Link from "next/link";
import { Cross1Icon, ExternalLinkIcon } from "@radix-ui/react-icons";

import { cn } from "@bob/ui";

import { MessageStream } from "~/app/(dashboard)/chat/_components/message-stream";
import { InputComposer } from "~/app/(dashboard)/chat/_components/input-composer";
import { AwaitingInputCard } from "~/app/(dashboard)/chat/_components/awaiting-input-card";
import { useChatSession } from "~/hooks/use-chat-session";

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
  const title = sessionData?.title ?? (sessionId ? `Session ${sessionId.slice(0, 8)}` : "Chat");

  return (
    <aside
      className="flex shrink-0 flex-col border-l border-white/8 bg-[#0c1120]"
      style={{ width: PANEL_WIDTH }}
    >
      {/* Header */}
      <div className="flex h-12 items-center justify-between border-b border-white/8 px-4">
        <div className="flex items-center gap-2 min-w-0">
          <div
            className={cn(
              "size-2 rounded-full",
              sessionStatus === "running" || sessionStatus === "idle"
                ? "bg-emerald-500"
                : sessionStatus === "error"
                  ? "bg-rose-500"
                  : "bg-white/20",
            )}
          />
          <span className="truncate text-sm font-medium text-white/80">
            {contextLabel ?? title}
          </span>
        </div>
        <div className="flex items-center gap-1">
          {sessionId && (
            <Link
              href={`/chat?session=${sessionId}`}
              className="rounded p-1 text-white/30 transition-colors hover:bg-white/5 hover:text-white/60"
              title="Open full page"
            >
              <ExternalLinkIcon className="size-3.5" />
            </Link>
          )}
          <button
            onClick={closePanel}
            className="rounded p-1 text-white/30 transition-colors hover:bg-white/5 hover:text-white/60"
            title="Close panel"
          >
            <Cross1Icon className="size-3.5" />
          </button>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto">
        {workflowState?.awaitingInput && (
          <div className="border-b border-white/8 p-3">
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
          <div className="flex h-full items-center justify-center text-sm text-white/35">
            No active session
          </div>
        )}
      </div>

      {/* Input */}
      <div className="border-t border-white/8">
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
