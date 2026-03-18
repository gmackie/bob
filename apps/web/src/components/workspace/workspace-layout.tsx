"use client";

import { useCallback, useState } from "react";
import type { ReactNode } from "react";

import { FileTree } from "~/components/workspace/file-tree";
import { TerminalComponent } from "~/components/dashboard/Terminal";

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
  const [fileTreeOpen, setFileTreeOpen] = useState(true);
  const [terminalOpen, setTerminalOpen] = useState(false);

  const toggleFileTree = useCallback(() => setFileTreeOpen((v) => !v), []);
  const toggleTerminal = useCallback(() => setTerminalOpen((v) => !v), []);

  return (
    <div className="flex h-[calc(100vh-64px)] overflow-hidden">
      {/* Left panel — File Tree */}
      {fileTreeOpen && rootPath && (
        <aside className="flex w-[240px] shrink-0 flex-col border-r border-border bg-card">
          <div className="flex items-center justify-between border-b border-border px-3 py-2">
            <div className="min-w-0">
              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                Files
              </div>
              {branchName && (
                <div className="mt-0.5 truncate text-xs text-muted-foreground/70">
                  {branchName}
                </div>
              )}
            </div>
            <button
              type="button"
              onClick={toggleFileTree}
              className="rounded p-1 text-muted-foreground transition hover:bg-accent hover:text-foreground"
              title="Hide file tree"
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <path d="M10 4L6 8L10 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </div>
          <div className="flex-1 overflow-y-auto overflow-x-hidden">
            <FileTree rootPath={rootPath} />
          </div>
        </aside>
      )}

      {/* Show file tree toggle when collapsed */}
      {(!fileTreeOpen || !rootPath) && (
        <button
          type="button"
          onClick={toggleFileTree}
          disabled={!rootPath}
          className="flex w-8 shrink-0 items-center justify-center border-r border-border bg-card text-muted-foreground transition hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
          title={rootPath ? "Show file tree" : "No workspace path available"}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M6 4L10 8L6 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      )}

      {/* Right side — main content + terminal */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Main content area */}
        <div className="flex-1 overflow-y-auto">
          {children}
        </div>

        {/* Terminal panel (bottom) */}
        <div className="shrink-0 border-t border-border">
          <button
            type="button"
            onClick={toggleTerminal}
            className="flex w-full items-center gap-2 bg-card px-4 py-1.5 text-xs font-medium text-muted-foreground transition hover:bg-accent hover:text-foreground"
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
              <path d="M2 4L6 8L2 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M8 12H14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
            Terminal
            <span className="ml-auto">
              {terminalOpen ? "\u25BC" : "\u25B2"}
            </span>
          </button>

          {terminalOpen && (
            <div className="h-[250px] bg-[#1a1a1a]">
              {activeSessionId ? (
                <TerminalComponent
                  sessionId={activeSessionId}
                  onClose={toggleTerminal}
                />
              ) : (
                <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                  No active session — start one to see the terminal
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
