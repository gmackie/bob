"use client";

import { useState } from "react";
import ReactMarkdown from "react-markdown";
import { cn } from "@bob/ui";

interface ArtifactPreviewPanelProps {
  /** Live content being built during the session */
  liveContent: string | null;
  /** Prior artifacts for context */
  priorArtifacts: Array<{
    id: string;
    title: string | null;
    content: string | null;
    createdAt: string;
  }>;
  /** Whether the session is still active (enables editing after completion) */
  isSessionActive: boolean;
  /** Called when user edits the artifact content post-session */
  onContentEdit?: (content: string) => void;
  className?: string;
}

export function ArtifactPreviewPanel({
  liveContent,
  priorArtifacts,
  isSessionActive,
  onContentEdit,
  className,
}: ArtifactPreviewPanelProps) {
  const [activeTab, setActiveTab] = useState<"live" | string>("live");
  const [isEditing, setIsEditing] = useState(false);
  const [editContent, setEditContent] = useState("");

  const hasTabs = priorArtifacts.length > 0;
  const displayContent = activeTab === "live"
    ? liveContent
    : priorArtifacts.find((a) => a.id === activeTab)?.content;

  return (
    <div className={cn("flex h-full flex-col bg-card", className)}>
      {/* Tabs (if prior artifacts exist) */}
      {hasTabs && (
        <div className="flex items-center gap-1 border-b border-border px-4 pt-3 pb-0">
          <button
            onClick={() => setActiveTab("live")}
            className={cn(
              "rounded-t-lg px-3 py-2 text-sm font-medium transition-colors",
              activeTab === "live"
                ? "bg-background text-foreground border-b-2 border-primary"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            Current Session
          </button>
          {priorArtifacts.map((a) => (
            <button
              key={a.id}
              onClick={() => setActiveTab(a.id)}
              className={cn(
                "rounded-t-lg px-3 py-2 text-sm font-medium transition-colors truncate max-w-[200px]",
                activeTab === a.id
                  ? "bg-background text-foreground border-b-2 border-primary"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {a.title ?? "Artifact"}
            </button>
          ))}
        </div>
      )}

      {/* Content area */}
      <div className="flex-1 overflow-y-auto px-6 py-4">
        {!displayContent ? (
          /* Empty / waiting state */
          <div className="flex h-full flex-col items-center justify-center text-center">
            <div className="rounded-full bg-primary/10 p-4">
              <svg className="h-8 w-8 text-primary animate-pulse" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
              </svg>
            </div>
            <p className="mt-4 text-sm font-medium text-foreground">
              Bob is thinking...
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              The artifact will appear here as it takes shape.
            </p>
          </div>
        ) : isEditing ? (
          /* Edit mode */
          <div className="h-full">
            <textarea
              value={editContent}
              onChange={(e) => setEditContent(e.target.value)}
              className="h-full w-full resize-none rounded-lg border border-border bg-background p-4 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
            />
          </div>
        ) : (
          /* Rendered markdown */
          <div className="prose prose-sm max-w-none dark:prose-invert prose-headings:font-display prose-headings:tracking-tight prose-p:text-foreground prose-li:text-foreground">
            <ReactMarkdown>{displayContent}</ReactMarkdown>
          </div>
        )}
      </div>

      {/* Footer — edit toggle (only after session completes) */}
      {!isSessionActive && displayContent && activeTab === "live" && (
        <div className="border-t border-border px-4 py-2 flex items-center justify-end gap-2">
          {isEditing ? (
            <>
              <button
                onClick={() => { setIsEditing(false); }}
                className="text-sm text-muted-foreground hover:text-foreground"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  onContentEdit?.(editContent);
                  setIsEditing(false);
                }}
                className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-white hover:bg-primary/90"
              >
                Save changes
              </button>
            </>
          ) : (
            <button
              onClick={() => {
                setEditContent(displayContent);
                setIsEditing(true);
              }}
              className="text-sm text-muted-foreground hover:text-foreground"
            >
              Edit artifact
            </button>
          )}
        </div>
      )}
    </div>
  );
}
