"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import {
  ChatBubbleIcon,
  CircleIcon,
  ExternalLinkIcon,
  StopIcon,
} from "@radix-ui/react-icons";

import { cn } from "@gmacko/core/ui";
import { Badge } from "@gmacko/core/ui/badge";

import { useChatSession } from "~/hooks/use-chat-session";
import { useTRPC } from "~/trpc/react";

import { AwaitingInputCard } from "./awaiting-input-card";
import { InputComposer } from "./input-composer";
import { MessageStream } from "./message-stream";

const LIVE_STATUSES = new Set(["provisioning", "starting", "running", "idle"]);

interface ChatSessionListItem {
  id: string;
  title: string | null;
  workingDirectory: string;
  status: string;
  lastActivityAt: string | Date | null;
}

interface ChatSessionListResult {
  items: ChatSessionListItem[];
}

interface ChatSessionDetails {
  title: string | null;
}

function formatSessionTime(value: string | Date | null | undefined): string {
  if (!value) return "No activity";
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "No activity";
  return date.toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function sessionStatusClass(status: string | null | undefined) {
  if (status === "error") return "text-red-600";
  if (status && LIVE_STATUSES.has(status)) return "text-emerald-600";
  return "text-muted-foreground";
}

export function FullChatPage() {
  const searchParams = useSearchParams();
  const selectedSessionId = searchParams.get("session");
  const trpc = useTRPC();

  const { data: sessionList, isLoading: isLoadingSessions } = useQuery(
    trpc.session.list.queryOptions({ limit: 30 }),
  );
  const sessionListResult = sessionList as unknown as
    | ChatSessionListResult
    | undefined;

  const {
    events,
    sendMessage,
    resolveInput,
    workflowState,
    sessionData,
    sessionStatus,
    isConnected,
    canSend,
    stopSession,
  } = useChatSession({
    sessionId: selectedSessionId,
    enabled: Boolean(selectedSessionId),
  });
  const selectedSession = sessionData as unknown as ChatSessionDetails | null;

  const isAwaitingInput = workflowState?.workflowStatus === "awaiting_input";
  const selectedTitle =
    selectedSession?.title ??
    sessionListResult?.items.find((session) => session.id === selectedSessionId)?.title ??
    (selectedSessionId ? `Session ${selectedSessionId.slice(0, 8)}` : "Select a chat");

  return (
    <div className="flex h-[calc(100vh-4rem)] min-h-[620px] flex-col overflow-hidden">
      <div className="flex items-center justify-between border-b border-border px-6 py-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Chats</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Inspect recent Bob and t3code backend sessions.
          </p>
        </div>
        {selectedSessionId ? (
          <Link
            href={`/runs?session=${selectedSessionId}`}
            className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <ExternalLinkIcon className="size-3.5" />
            Runs
          </Link>
        ) : null}
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-[320px_minmax(0,1fr)]">
        <aside className="min-h-0 border-r border-border bg-muted/20">
          <div className="border-b border-border px-4 py-3">
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Recent sessions
            </p>
          </div>
          <div className="min-h-0 overflow-y-auto">
            {isLoadingSessions ? (
              <div className="space-y-2 p-3">
                {Array.from({ length: 6 }).map((_, index) => (
                  <div
                    key={index}
                    className="h-16 animate-pulse rounded-md bg-muted"
                  />
                ))}
              </div>
            ) : sessionListResult?.items.length ? (
              <div className="p-2">
                {sessionListResult.items.map((session) => {
                  const isSelected = session.id === selectedSessionId;
                  return (
                    <Link
                      key={session.id}
                      href={`/chat?session=${session.id}`}
                      className={cn(
                        "block rounded-md px-3 py-2 transition-colors",
                        isSelected
                          ? "bg-accent text-foreground"
                          : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
                      )}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium">
                            {session.title ?? `Session ${session.id.slice(0, 8)}`}
                          </p>
                          <p className="mt-1 truncate text-xs">
                            {session.workingDirectory}
                          </p>
                        </div>
                        <CircleIcon
                          className={cn(
                            "mt-1 size-2 shrink-0 fill-current",
                            sessionStatusClass(session.status),
                          )}
                        />
                      </div>
                      <div className="mt-2 flex items-center justify-between gap-2">
                        <Badge variant="slate" className="text-[10px] capitalize">
                          {session.status}
                        </Badge>
                        <span className="truncate text-[11px]">
                          {formatSessionTime(session.lastActivityAt)}
                        </span>
                      </div>
                    </Link>
                  );
                })}
              </div>
            ) : (
              <div className="p-6 text-sm text-muted-foreground">
                No sessions found.
              </div>
            )}
          </div>
        </aside>

        <main className="flex min-h-0 flex-col">
          <div className="flex min-h-16 items-center justify-between border-b border-border px-5 py-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <CircleIcon
                  className={cn(
                    "size-2.5 fill-current",
                    sessionStatusClass(selectedSessionId ? sessionStatus : null),
                  )}
                />
                <h2 className="truncate text-base font-semibold">
                  {selectedTitle}
                </h2>
              </div>
              {selectedSessionId ? (
                <p className="mt-1 truncate font-mono text-xs text-muted-foreground">
                  {selectedSessionId}
                </p>
              ) : null}
            </div>
            {selectedSessionId ? (
              <button
                type="button"
                onClick={stopSession}
                disabled={!canSend}
                className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
              >
                <StopIcon className="size-3.5" />
                Stop
              </button>
            ) : null}
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
            {selectedSessionId ? (
              <MessageStream
                sessionId={selectedSessionId}
                events={events}
                isConnected={isConnected}
              />
            ) : (
              <div className="flex h-full flex-col items-center justify-center gap-3 px-8 text-center text-muted-foreground">
                <ChatBubbleIcon className="size-8" />
                <p className="text-sm">Select a recent session to inspect its chat.</p>
              </div>
            )}
          </div>

          <div className="border-t border-border">
            <InputComposer
              onSend={sendMessage}
              disabled={!canSend || isAwaitingInput}
              sessionId={selectedSessionId ?? undefined}
              placeholder={
                !selectedSessionId
                  ? "Select a session"
                  : !isConnected
                    ? "Connecting..."
                    : isAwaitingInput
                      ? "Resolve input prompt above"
                      : "Type a message..."
              }
            />
          </div>
        </main>
      </div>
    </div>
  );
}
