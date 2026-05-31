"use client";

import type { ReactNode } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { ErrorBoundary } from "@bob/ui/error-boundary";

import type { SessionEvent } from "~/hooks/use-session-socket";
import { TerminalComponent } from "~/components/dashboard/Terminal";
import { CapturePanel } from "~/components/workspace/capture-panel";
import { ChangesetActions } from "~/components/workspace/changeset-actions";
import { FileTree } from "~/components/workspace/file-tree";
import { RevisionGraph } from "~/components/workspace/revision-graph";
import { useFileChangeEvents } from "~/hooks/use-file-change-events";
import { useSessionEvents } from "~/hooks/use-session-events";
import { useSessionSocket } from "~/hooks/use-session-socket";
import { useTRPC } from "~/trpc/react";

type CenterTab = "content" | "capture" | "revisions";

interface WorkspaceLayoutProps {
  /** Absolute path to the worktree / repository root for the file tree */
  rootPath: string | null;
  /** Branch name to display in the file tree header */
  branchName: string | null;
  /** Active session ID for the terminal panel */
  activeSessionId: string | null;
  /** Main content (the existing workspace cards) */
  children: ReactNode;
}

export function WorkspaceLayout({
  rootPath,
  branchName,
  activeSessionId,
  children,
}: WorkspaceLayoutProps) {
  const trpc = useTRPC();
  const [fileTreeOpen, setFileTreeOpen] = useState(true);
  const [terminalOpen, setTerminalOpen] = useState(false);
  const [centerTab, setCenterTab] = useState<CenterTab>("content");

  // Track "new updates" badges for tabs the user isn't currently viewing
  const [contentHasUpdates, setContentHasUpdates] = useState(false);
  const [revisionsHasUpdates, setRevisionsHasUpdates] = useState(false);

  // Keep current tab in a ref so event callbacks don't go stale
  const centerTabRef = useRef<CenterTab>(centerTab);
  centerTabRef.current = centerTab;

  // Listen for file_change events — badge the Content tab when not active
  useFileChangeEvents({
    sessionId: activeSessionId,
    enabled: Boolean(activeSessionId),
    interval: 3_000,
    onFileChange: useCallback(() => {
      if (centerTabRef.current !== "content") {
        setContentHasUpdates(true);
      }
    }, []),
  });

  // Listen for build/deploy events — badge the Revisions tab when not active
  const { events: buildEvents } = useSessionEvents({
    sessionId: activeSessionId,
    enabled: Boolean(activeSessionId),
    interval: 5_000,
    eventTypes: ["build_status", "deploy_status"],
  });

  const { data: gatewayInfo } = useQuery(
    trpc.session.getGatewayWebSocketUrl.queryOptions(undefined, {
      enabled: Boolean(activeSessionId),
      staleTime: 60_000,
    }),
  );

  const handleBuildSocketEvent = useCallback((event: SessionEvent) => {
    if (
      (event.eventType === "build_status" ||
        event.eventType === "deploy_status") &&
      centerTabRef.current !== "revisions"
    ) {
      setRevisionsHasUpdates(true);
    }
  }, []);

  const { connectionState, subscribe, unsubscribe } = useSessionSocket({
    gatewayUrl: gatewayInfo?.url ?? "",
    token: gatewayInfo?.token ?? "",
    onEvent: handleBuildSocketEvent,
    enabled: Boolean(activeSessionId && gatewayInfo?.token),
  });

  useEffect(() => {
    if (!activeSessionId || connectionState.status !== "connected") return;
    subscribe(activeSessionId);
    return () => unsubscribe(activeSessionId);
  }, [activeSessionId, connectionState.status, subscribe, unsubscribe]);

  useEffect(() => {
    if (
      buildEvents &&
      buildEvents.length > 0 &&
      centerTabRef.current !== "revisions"
    ) {
      setRevisionsHasUpdates(true);
    }
  }, [buildEvents]);

  const handleTabChange = useCallback((tab: CenterTab) => {
    setCenterTab(tab);
    if (tab === "content") setContentHasUpdates(false);
    if (tab === "revisions") setRevisionsHasUpdates(false);
  }, []);

  const toggleFileTree = useCallback(() => setFileTreeOpen((v) => !v), []);
  const toggleTerminal = useCallback(() => setTerminalOpen((v) => !v), []);

  return (
    <div className="flex h-[calc(100vh-64px)] overflow-hidden">
      {/* Left panel — File Tree */}
      {fileTreeOpen && rootPath && (
        <aside className="border-border bg-card flex w-[240px] shrink-0 flex-col border-r">
          <div className="border-border flex items-center justify-between border-b px-3 py-2">
            <div className="min-w-0">
              <div className="text-muted-foreground text-xs font-semibold tracking-[0.18em] uppercase">
                Files
              </div>
              {branchName && (
                <div className="text-muted-foreground/70 mt-0.5 truncate text-xs">
                  {branchName}
                </div>
              )}
            </div>
            <button
              type="button"
              onClick={toggleFileTree}
              className="text-muted-foreground hover:bg-accent hover:text-foreground rounded p-1 transition"
              title="Hide file tree"
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <path
                  d="M10 4L6 8L10 12"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
          </div>
          <div className="flex-1 overflow-x-hidden overflow-y-auto">
            <ErrorBoundary section="File Tree">
              <FileTree rootPath={rootPath} sessionId={activeSessionId} />
            </ErrorBoundary>
          </div>
        </aside>
      )}

      {/* Show file tree toggle when collapsed */}
      {(!fileTreeOpen || !rootPath) && (
        <button
          type="button"
          onClick={toggleFileTree}
          disabled={!rootPath}
          className="border-border bg-card text-muted-foreground hover:bg-accent hover:text-foreground flex w-8 shrink-0 items-center justify-center border-r transition disabled:cursor-not-allowed disabled:opacity-50"
          title={rootPath ? "Show file tree" : "No workspace path available"}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path
              d="M6 4L10 8L6 12"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      )}

      {/* Right side — main content + terminal */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Center panel tabs */}
        <div className="border-border bg-card flex shrink-0 items-center gap-1 border-b px-4">
          <button
            type="button"
            onClick={() => handleTabChange("content")}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium transition ${
              centerTab === "content"
                ? "border-primary text-foreground border-b-2"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            Content
            {contentHasUpdates && (
              <span
                className="bg-primary size-1.5 rounded-full"
                aria-label="New updates"
              />
            )}
          </button>
          <button
            type="button"
            onClick={() => handleTabChange("capture")}
            className={`px-3 py-1.5 text-xs font-medium transition ${
              centerTab === "capture"
                ? "border-primary text-foreground border-b-2"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            Capture
          </button>
          {rootPath && (
            <button
              type="button"
              onClick={() => handleTabChange("revisions")}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium transition ${
                centerTab === "revisions"
                  ? "border-primary text-foreground border-b-2"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Revisions
              {revisionsHasUpdates && (
                <span
                  className="bg-primary size-1.5 rounded-full"
                  aria-label="New updates"
                />
              )}
            </button>
          )}
        </div>

        {/* Main content area */}
        <div className="flex-1 overflow-y-auto">
          {centerTab === "content" && children}
          {centerTab === "capture" && (
            <ErrorBoundary section="Screen Capture">
              <CapturePanel sessionId={activeSessionId} />
            </ErrorBoundary>
          )}
          {centerTab === "revisions" && rootPath && (
            <ErrorBoundary section="Revisions">
              <div className="space-y-4 p-4">
                <RevisionGraph worktreePath={rootPath} />
                <ChangesetActions worktreePath={rootPath} />
              </div>
            </ErrorBoundary>
          )}
        </div>

        {/* Terminal panel (bottom) */}
        <div className="border-border shrink-0 border-t">
          <button
            type="button"
            onClick={toggleTerminal}
            className="bg-card text-muted-foreground hover:bg-accent hover:text-foreground flex w-full items-center gap-2 px-4 py-1.5 text-xs font-medium transition"
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
              <path
                d="M2 4L6 8L2 12"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <path
                d="M8 12H14"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </svg>
            Terminal
            <span className="ml-auto">
              {terminalOpen ? "\u25BC" : "\u25B2"}
            </span>
          </button>

          {terminalOpen && (
            <ErrorBoundary section="Terminal">
              <div className="h-[250px] bg-[#1a1a1a]">
                {activeSessionId ? (
                  <TerminalComponent
                    sessionId={activeSessionId}
                    onClose={toggleTerminal}
                  />
                ) : (
                  <div className="text-muted-foreground flex h-full items-center justify-center text-sm">
                    No active session — start one to see the terminal
                  </div>
                )}
              </div>
            </ErrorBoundary>
          )}
        </div>
      </div>
    </div>
  );
}
