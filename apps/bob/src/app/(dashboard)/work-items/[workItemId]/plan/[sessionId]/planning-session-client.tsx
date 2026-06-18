"use client";

import { useEffect, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ExternalLinkIcon } from "@radix-ui/react-icons";

import { cn } from "@gmacko/core/ui";
import { toast } from "@gmacko/core/ui/toast";

import { MessageStream } from "~/app/(dashboard)/chat/_components/message-stream";
import { InputComposer } from "~/app/(dashboard)/chat/_components/input-composer";
import { AwaitingInputCard } from "~/app/(dashboard)/chat/_components/awaiting-input-card";
import { useChatSession } from "~/hooks/use-chat-session";
import { useTRPC } from "~/trpc/react";

import { ResizableSplitView } from "~/components/planning/resizable-split-view";
import { ArtifactPreviewPanel } from "~/components/planning/artifact-preview-panel";

import type { SessionEvent } from "~/hooks/use-session-socket";

interface PlanningSessionClientProps {
  workItem: {
    id: string;
    identifier: string;
    title: string;
    description: string | null;
    projectId: string | null;
    projectName: string | null;
    workspaceId: string;
  };
  session: {
    id: string;
    status: string;
    planningSessionType: string | null;
  };
  priorArtifacts: Array<{
    id: string;
    title: string | null;
    content: string | null;
    createdAt: string;
  }>;
  isReadOnly: boolean;
}

/**
 * Extract artifact content from assistant messages.
 *
 * Looks for:
 * 1. Fenced ```markdown ... ``` blocks (returns inner content)
 * 2. Large structured content after a top-level "# " heading (>400 chars)
 *
 * Returns the *last* detected artifact so the preview always shows the latest.
 */
function extractArtifactContent(events: SessionEvent[]): string | null {
  // Accumulate all agent output as the artifact content
  // This builds a running document of the planning conversation's outputs
  const outputParts: string[] = [];

  for (const event of events) {
    if (event.direction !== "agent") continue;

    if (event.eventType === "output_chunk") {
      const text = toDisplayText(event.payload.data);
      if (text) outputParts.push(text);
    }

    if (event.eventType === "message_final") {
      const text = toDisplayText(event.payload.content);
      if (text) {
        // message_final replaces accumulated chunks for this message
        outputParts.push(text);
      }
    }
  }

  const combined = outputParts.join("").trim();
  return combined.length > 0 ? combined : null;
}

function toDisplayText(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === null || value === undefined) return "";
  try {
    return JSON.stringify(value);
  } catch {
    return "";
  }
}

export function PlanningSessionClient({
  workItem,
  session,
  priorArtifacts,
  isReadOnly,
}: PlanningSessionClientProps) {
  const trpc = useTRPC();
  const router = useRouter();
  const [artifactContent, setArtifactContent] = useState<string | null>(null);
  const startedRef = useRef(false);

  // Start the session on the gateway if it's still provisioning
  const startSession = useMutation(
    trpc.planSession.start.mutationOptions({
      onError: () => {
        // Allow retry on failure
        startedRef.current = false;
      },
    }),
  );

  // Save artifact content to work item
  const saveArtifact = useMutation(
    trpc.planSession.saveArtifact.mutationOptions(),
  );

  // Wire up the chat session (same hook as ChatPanel uses)
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
  } = useChatSession({ sessionId: session.id, enabled: true });

  // Also check the live session status — if it's stuck at provisioning, retry
  const shouldStart =
    !isReadOnly &&
    !startedRef.current &&
    workItem.projectId &&
    (session.status === "provisioning" ||
      (sessionStatus === "stopped" && session.status !== "stopped"));

  useEffect(() => {
    if (shouldStart && workItem.projectId) {
      startedRef.current = true;
      startSession.mutate({
        sessionId: session.id,
        workspaceId: workItem.workspaceId,
        projectId: workItem.projectId,
        projectName: workItem.projectName ?? "Project",
        workingDirectory: "/",
      });
    }
  }, [shouldStart, session.id, workItem, startSession]);

  // Extract artifact content from events whenever they change
  useEffect(() => {
    const extracted = extractArtifactContent(events);
    if (extracted) {
      setArtifactContent(extracted);
    }
  }, [events]);

  const handleEndSession = () => {
    // Save artifact if there's content
    if (artifactContent && artifactContent.length > 0) {
      saveArtifact.mutate({
        sessionId: session.id,
        workItemId: workItem.id,
        title: `${session.planningSessionType ?? "Planning"} — ${workItem.title}`,
        content: artifactContent,
        planningSessionType: (session.planningSessionType as "shape" | "breakdown" | "office_hours" | "ceo_review" | "eng_review" | "design_review" | undefined) ?? undefined,
      }, {
        onSuccess: () => {
          toast.success("Artifact saved to work item");
        },
        onError: () => {
          toast.error("Failed to save artifact");
        },
      });
    }

    // Stop the session
    stopSession();

    // Navigate back to work item
    router.push(`/work-items/${workItem.id}`);
  };

  const isAwaitingInput = workflowState?.workflowStatus === "awaiting_input";

  const statusIndicator = (
    <div className="flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground border-b border-border">
      <div
        className={cn(
          "size-2 rounded-full",
          sessionStatus === "running" || sessionStatus === "idle"
            ? "bg-emerald-500"
            : sessionStatus === "error"
              ? "bg-rose-500"
              : sessionStatus === "provisioning" || sessionStatus === "starting"
                ? "bg-amber-500 animate-pulse"
                : "bg-muted-foreground",
        )}
      />
      <span className="capitalize">{sessionStatus}</span>
      {!isConnected && sessionStatus !== "stopped" && (
        <span className="text-muted-foreground/60">(connecting...)</span>
      )}
      {(sessionStatus === "provisioning" || sessionStatus === "error" || sessionStatus === "stopped") && !isReadOnly && (
        <button
          onClick={() => {
            startedRef.current = false;
            startSession.mutate({
              sessionId: session.id,
              workspaceId: workItem.workspaceId,
              projectId: workItem.projectId!,
              projectName: workItem.projectName ?? "Project",
              workingDirectory: "/",
            });
          }}
          disabled={startSession.isPending}
          className="rounded bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary hover:bg-primary/20 transition-colors"
        >
          {startSession.isPending ? "Starting..." : "Retry"}
        </button>
      )}
      <Link
        href={`/chat?session=${session.id}`}
        className="ml-auto flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors"
        title="Open in full chat"
      >
        <ExternalLinkIcon className="size-3" />
        <span>Full view</span>
      </Link>
      {!isReadOnly && (
        <button
          onClick={handleEndSession}
          className="ml-2 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          End session
        </button>
      )}
    </div>
  );

  const chatPanel = (
    <div className="flex h-full flex-col bg-background">
      {statusIndicator}

      {/* Awaiting input prompt */}
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

      {/* Messages */}
      <div className="flex-1 overflow-y-auto">
        <MessageStream
          sessionId={session.id}
          events={events}
          isConnected={isConnected}
        />
      </div>

      {/* Input */}
      {!isReadOnly && (
        <div className="border-t border-border">
          <InputComposer
            onSend={sendMessage}
            disabled={!canSend || isAwaitingInput}
            sessionId={session.id}
            placeholder={
              !isConnected
                ? "Connecting..."
                : sessionStatus === "provisioning" || sessionStatus === "starting"
                  ? "Session starting..."
                  : isAwaitingInput
                    ? "Resolve input prompt above"
                    : "Type a message..."
            }
          />
        </div>
      )}
    </div>
  );

  return (
    <div className="flex-1 overflow-hidden">
      {/* Desktop: split view */}
      <div className="hidden h-full md:block">
        <ResizableSplitView
          storageKey={`planning-split-${workItem.id}`}
          left={chatPanel}
          right={
            <ArtifactPreviewPanel
              liveContent={artifactContent}
              priorArtifacts={priorArtifacts}
              isSessionActive={!isReadOnly}
            />
          }
        />
      </div>

      {/* Mobile: tab view */}
      <div className="flex h-full flex-col md:hidden">
        <MobilePlanningTabs
          chatPanel={chatPanel}
          artifactContent={artifactContent}
          priorArtifacts={priorArtifacts}
          isReadOnly={isReadOnly}
          sessionId={session.id}
        />
      </div>
    </div>
  );
}

function MobilePlanningTabs({
  chatPanel,
  artifactContent,
  priorArtifacts,
  isReadOnly,
  sessionId,
}: {
  chatPanel: React.ReactNode;
  artifactContent: string | null;
  priorArtifacts: Array<{ id: string; title: string | null; content: string | null; createdAt: string }>;
  isReadOnly: boolean;
  sessionId: string;
}) {
  const [tab, setTab] = useState<"chat" | "artifact">("chat");

  return (
    <>
      <div className="flex border-b border-border">
        {(["chat", "artifact"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`flex-1 py-3 text-sm font-medium transition-colors ${
              tab === t
                ? "border-b-2 border-primary text-primary"
                : "text-muted-foreground"
            }`}
          >
            {t === "chat" ? "Chat" : "Artifact"}
          </button>
        ))}
      </div>
      <div className="flex-1 overflow-hidden">
        {tab === "chat" ? (
          chatPanel
        ) : (
          <ArtifactPreviewPanel
            liveContent={artifactContent}
            priorArtifacts={priorArtifacts}
            isSessionActive={!isReadOnly}
          />
        )}
      </div>
    </>
  );
}
