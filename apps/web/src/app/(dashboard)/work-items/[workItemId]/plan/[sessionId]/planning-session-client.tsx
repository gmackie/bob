"use client";

import { useState } from "react";

import { ResizableSplitView } from "~/components/planning/resizable-split-view";
import { ArtifactPreviewPanel } from "~/components/planning/artifact-preview-panel";

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

export function PlanningSessionClient({
  workItem,
  session,
  priorArtifacts,
  isReadOnly,
}: PlanningSessionClientProps) {
  const [artifactContent, setArtifactContent] = useState<string | null>(null);

  // TODO: Wire up to actual chat messages stream
  // For v1, the chat panel component will need to expose a callback
  // that fires when new messages arrive, allowing us to parse artifact content.

  return (
    <div className="flex-1 overflow-hidden">
      {/* Desktop: split view */}
      <div className="hidden h-full md:block">
        <ResizableSplitView
          storageKey={`planning-split-${workItem.id}`}
          left={
            <div className="flex h-full flex-col bg-background p-4">
              {/* Chat panel placeholder — will be wired to existing ChatPanel */}
              <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">
                Chat panel will be embedded here.
                <br />
                Session: {session.id}
              </div>
            </div>
          }
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
  artifactContent,
  priorArtifacts,
  isReadOnly,
  sessionId,
}: {
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
          <div className="flex h-full items-center justify-center text-muted-foreground text-sm p-4">
            Chat panel (mobile)
          </div>
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
