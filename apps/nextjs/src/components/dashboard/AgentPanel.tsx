"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";

import type { ClaudeInstance, Worktree } from "~/lib/legacy/types";
import { api } from "~/lib/rest/api";
import { TerminalComponent } from "./Terminal";

interface AgentPanelProps {
  selectedWorktree: Worktree | null;
  selectedInstance: ClaudeInstance | null;
  onRestartInstance: (instanceId: string) => Promise<void>;
  onStopInstance: (instanceId: string) => Promise<void>;
  onStartInstance: (worktreeId: string) => Promise<void>;
  onDeleteWorktree: (worktreeId: string, force: boolean) => Promise<void>;
  error: string | null;
  isLeftPanelCollapsed: boolean;
}

type ActiveTab = "dashboard" | "claude" | "directory" | "git";

export function AgentPanel({
  selectedWorktree,
  selectedInstance,
  onRestartInstance,
  onStopInstance,
  onStartInstance,
  onDeleteWorktree,
  error,
  isLeftPanelCollapsed,
}: AgentPanelProps) {
  // Terminal session state
  const [claudeTerminalSessionId, setClaudeTerminalSessionId] = useState<
    string | null
  >(null);
  const [directoryTerminalSessionId, setDirectoryTerminalSessionId] = useState<
    string | null
  >(null);
  const [activeTab, setActiveTab] = useState<ActiveTab>("dashboard");
  const [isCreatingClaudeSession, setIsCreatingClaudeSession] = useState(false);
  const [isCreatingDirectorySession, setIsCreatingDirectorySession] =
    useState(false);
  const [isRestarting, setIsRestarting] = useState(false);
  const [isStopping, setIsStopping] = useState(false);

  // Git state
  const [gitDiff, setGitDiff] = useState<string>("");
  const [gitLoading, setGitLoading] = useState(false);

  // Session cache for storing terminal session IDs per instance
  const sessionCacheRef = useRef<
    Map<string, { claude: string | null; directory: string | null }>
  >(new Map());

  // Reset state when switching instances
  useEffect(() => {
    console.log(
      `Switching to instance: ${selectedInstance?.id}, clearing session state`,
    );
    setClaudeTerminalSessionId(null);
    setDirectoryTerminalSessionId(null);
    setGitDiff("");
    setActiveTab("dashboard");
  }, [selectedInstance?.id]);

  // Restore cached sessions when switching instances
  useEffect(() => {
    if (selectedInstance?.id) {
      const cached = sessionCacheRef.current.get(selectedInstance.id);
      if (cached?.claude) {
        setClaudeTerminalSessionId(cached.claude);
      }
      if (cached?.directory) {
        setDirectoryTerminalSessionId(cached.directory);
      }
    }
  }, [selectedInstance?.id]);

  const handleOpenClaudeTerminal = useCallback(async () => {
    if (!selectedInstance || selectedInstance.status !== "running") return;

    setIsCreatingClaudeSession(true);
    try {
      // First check for existing Claude session
      const existingSessions = await api.getTerminalSessions(
        selectedInstance.id,
      );
      const claudeSession = existingSessions.find((s) => s.type === "claude");

      if (claudeSession) {
        setClaudeTerminalSessionId(claudeSession.id);
      } else {
        const { sessionId } = await api.createTerminalSession(
          selectedInstance.id,
        );
        setClaudeTerminalSessionId(sessionId);
        const cached = sessionCacheRef.current.get(selectedInstance.id) || {
          claude: null,
          directory: null,
        };
        sessionCacheRef.current.set(selectedInstance.id, {
          ...cached,
          claude: sessionId,
        });
      }
      setActiveTab("claude");
    } catch (error) {
      console.error("Failed to create Claude terminal session:", error);
    } finally {
      setIsCreatingClaudeSession(false);
    }
  }, [selectedInstance]);

  const handleOpenDirectoryTerminal = useCallback(async () => {
    if (!selectedInstance) return;

    setIsCreatingDirectorySession(true);
    try {
      // First check for existing directory session
      const existingSessions = await api.getTerminalSessions(
        selectedInstance.id,
      );
      const directorySession = existingSessions.find(
        (s) => s.type === "directory",
      );

      if (directorySession) {
        setDirectoryTerminalSessionId(directorySession.id);
      } else {
        const { sessionId } = await api.createDirectoryTerminalSession(
          selectedInstance.id,
        );
        setDirectoryTerminalSessionId(sessionId);
        const cached = sessionCacheRef.current.get(selectedInstance.id) || {
          claude: null,
          directory: null,
        };
        sessionCacheRef.current.set(selectedInstance.id, {
          ...cached,
          directory: sessionId,
        });
      }
      setActiveTab("directory");
    } catch (error) {
      console.error("Failed to create directory terminal session:", error);
    } finally {
      setIsCreatingDirectorySession(false);
    }
  }, [selectedInstance]);

  const handleCloseTerminal = useCallback(
    async (terminalType: "claude" | "directory") => {
      if (terminalType === "claude" && claudeTerminalSessionId) {
        try {
          await api.closeTerminalSession(claudeTerminalSessionId);
        } catch (e) {
          console.error("Failed to close claude session:", e);
        }
        setClaudeTerminalSessionId(null);
        if (selectedInstance?.id) {
          const cached = sessionCacheRef.current.get(selectedInstance.id);
          if (cached) {
            sessionCacheRef.current.set(selectedInstance.id, {
              ...cached,
              claude: null,
            });
          }
        }
      } else if (terminalType === "directory" && directoryTerminalSessionId) {
        try {
          await api.closeTerminalSession(directoryTerminalSessionId);
        } catch (e) {
          console.error("Failed to close directory session:", e);
        }
        setDirectoryTerminalSessionId(null);
        if (selectedInstance?.id) {
          const cached = sessionCacheRef.current.get(selectedInstance.id);
          if (cached) {
            sessionCacheRef.current.set(selectedInstance.id, {
              ...cached,
              directory: null,
            });
          }
        }
      }
    },
    [claudeTerminalSessionId, directoryTerminalSessionId, selectedInstance?.id],
  );

  const handleRestartInstance = async () => {
    if (!selectedInstance) return;

    setIsRestarting(true);
    try {
      // Close any existing terminal sessions
      if (claudeTerminalSessionId) {
        await handleCloseTerminal("claude");
      }
      if (directoryTerminalSessionId) {
        await handleCloseTerminal("directory");
      }

      await onRestartInstance(selectedInstance.id);
    } catch (error) {
      console.error("Failed to restart instance:", error);
    } finally {
      setIsRestarting(false);
    }
  };

  const handleStopInstance = async () => {
    if (!selectedInstance) return;

    setIsStopping(true);
    try {
      // Close any existing terminal sessions
      if (claudeTerminalSessionId) {
        await handleCloseTerminal("claude");
      }
      if (directoryTerminalSessionId) {
        await handleCloseTerminal("directory");
      }

      await onStopInstance(selectedInstance.id);
    } catch (error) {
      console.error("Failed to stop instance:", error);
    } finally {
      setIsStopping(false);
    }
  };

  // Git operations
  const loadGitDiff = async () => {
    if (!selectedWorktree) return;

    setGitLoading(true);
    try {
      const diff = await api.getGitDiff(selectedWorktree.id);
      setGitDiff(diff);
    } catch (error) {
      console.error("Failed to load git diff:", error);
      setGitDiff("");
    } finally {
      setGitLoading(false);
    }
  };

  // Load git diff when switching to git tab
  useEffect(() => {
    if (activeTab === "git" && selectedWorktree) {
      loadGitDiff();
    }
  }, [activeTab, selectedWorktree?.id]);

  if (!selectedWorktree) {
    return (
      <div
        className="right-panel"
        style={{
          width: isLeftPanelCollapsed
            ? "calc(100% - 60px)"
            : "calc(100% - 360px)",
        }}
      >
        <div className="empty-terminal">
          <h2>Welcome to Bob</h2>
          <p>Select a worktree from the left panel to get started.</p>
          <p>
            Or add a new repository using the &quot;Add Repository&quot; button.
          </p>
        </div>
      </div>
    );
  }

  const getBranchDisplayName = (branch: string) => {
    return branch.replace(/^refs\/heads\//, "");
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "running":
        return "#28a745";
      case "starting":
        return "#ffc107";
      case "error":
        return "#dc3545";
      case "stopped":
        return "#6c757d";
      default:
        return "#888";
    }
  };

  const getAgentDisplayName = () => {
    if (!selectedInstance) return "Agent";
    const agentType = selectedInstance.agentType || "claude";
    return agentType.charAt(0).toUpperCase() + agentType.slice(1);
  };

  return (
    <div
      className="right-panel"
      style={{
        width: isLeftPanelCollapsed
          ? "calc(100% - 60px)"
          : "calc(100% - 360px)",
      }}
    >
      {/* Panel Header */}
      <div
        className="panel-header"
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          padding: "12px 16px",
          borderBottom: "1px solid #333",
          backgroundColor: "#1e1e1e",
        }}
      >
        <div>
          <h3 style={{ margin: 0, color: "#ffffff" }}>
            {getAgentDisplayName()} Instance
            {selectedInstance && (
              <span
                style={{
                  marginLeft: "12px",
                  fontSize: "11px",
                  padding: "2px 6px",
                  borderRadius: "3px",
                  backgroundColor: getStatusColor(selectedInstance.status),
                  color:
                    selectedInstance.status === "starting" ? "#000" : "#fff",
                }}
              >
                {selectedInstance.status}
              </span>
            )}
          </h3>
          <div style={{ fontSize: "12px", color: "#888", marginTop: "2px" }}>
            {getBranchDisplayName(selectedWorktree.branch)} •{" "}
            {selectedWorktree.path}
          </div>
        </div>

        <div style={{ display: "flex", gap: "8px" }}>
          {selectedInstance?.status === "running" && (
            <button
              onClick={handleStopInstance}
              disabled={isStopping}
              className="action-button danger"
              style={{ fontSize: "12px", padding: "6px 12px" }}
            >
              {isStopping ? "Stopping..." : `Stop ${getAgentDisplayName()}`}
            </button>
          )}

          {(selectedInstance?.status === "stopped" ||
            selectedInstance?.status === "error") && (
            <button
              onClick={handleRestartInstance}
              disabled={isRestarting}
              className="action-button"
              style={{ fontSize: "12px", padding: "6px 12px" }}
            >
              {isRestarting
                ? "Restarting..."
                : `Restart ${getAgentDisplayName()}`}
            </button>
          )}

          {!selectedInstance && (
            <button
              onClick={() => onStartInstance(selectedWorktree.id)}
              className="action-button primary"
              style={{ fontSize: "12px", padding: "6px 12px" }}
            >
              ▶ Start Agent
            </button>
          )}

          <button
            onClick={() => {
              if (
                confirm(
                  `Delete worktree "${getBranchDisplayName(selectedWorktree.branch)}"?`,
                )
              ) {
                onDeleteWorktree(selectedWorktree.id, false);
              }
            }}
            className="action-button danger"
            style={{ fontSize: "12px", padding: "6px 12px" }}
          >
            🗑 Delete
          </button>
        </div>
      </div>

      {/* Error display */}
      {error && (
        <div
          style={{
            background: "#2d1b1b",
            border: "1px solid #5a1f1f",
            color: "#ff6b6b",
            padding: "12px 16px",
            fontSize: "14px",
            borderBottom: "1px solid #333",
          }}
        >
          <strong>Error:</strong> {error}
        </div>
      )}

      {/* Tabbed interface */}
      <div style={{ display: "flex", borderBottom: "1px solid #444" }}>
        <button
          onClick={() => setActiveTab("dashboard")}
          style={{
            background: activeTab === "dashboard" ? "#444" : "transparent",
            border: "none",
            color: "#fff",
            padding: "12px 24px",
            cursor: "pointer",
            borderBottom:
              activeTab === "dashboard"
                ? "2px solid #007acc"
                : "2px solid transparent",
            fontSize: "13px",
          }}
        >
          Dashboard
        </button>
        <button
          onClick={() => {
            if (!selectedInstance) return;
            setActiveTab("claude");
            if (
              !claudeTerminalSessionId &&
              selectedInstance?.status === "running"
            ) {
              setTimeout(() => handleOpenClaudeTerminal(), 100);
            }
          }}
          disabled={!selectedInstance}
          style={{
            background: activeTab === "claude" ? "#444" : "transparent",
            border: "none",
            color: !selectedInstance ? "#666" : "#fff",
            padding: "12px 24px",
            cursor: !selectedInstance ? "not-allowed" : "pointer",
            borderBottom:
              activeTab === "claude"
                ? "2px solid #007acc"
                : "2px solid transparent",
            fontSize: "13px",
            opacity: !selectedInstance ? 0.5 : 1,
          }}
        >
          {getAgentDisplayName()} {claudeTerminalSessionId && "●"}
        </button>
        <button
          onClick={() => {
            setActiveTab("directory");
            if (
              !directoryTerminalSessionId &&
              selectedInstance?.status === "running"
            ) {
              setTimeout(() => handleOpenDirectoryTerminal(), 100);
            }
          }}
          style={{
            background: activeTab === "directory" ? "#444" : "transparent",
            border: "none",
            color: "#fff",
            padding: "12px 24px",
            cursor: "pointer",
            borderBottom:
              activeTab === "directory"
                ? "2px solid #007acc"
                : "2px solid transparent",
            fontSize: "13px",
          }}
        >
          Terminal {directoryTerminalSessionId && "●"}
        </button>
        <button
          onClick={() => setActiveTab("git")}
          style={{
            background: activeTab === "git" ? "#444" : "transparent",
            border: "none",
            color: "#fff",
            padding: "12px 24px",
            cursor: "pointer",
            borderBottom:
              activeTab === "git"
                ? "2px solid #007acc"
                : "2px solid transparent",
            fontSize: "13px",
          }}
        >
          Git {gitDiff && gitDiff.trim() && "●"}
        </button>
      </div>

      {/* Tab Content */}
      <div
        className="terminal-content"
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          minHeight: 0,
        }}
      >
        {/* Dashboard Tab */}
        <div
          style={{
            display: activeTab === "dashboard" ? "flex" : "none",
            flexDirection: "column",
            flex: 1,
            minHeight: 0,
            padding: "20px",
            overflow: "auto",
          }}
        >
          <h3 style={{ marginBottom: "20px", color: "#e6edf3" }}>
            Worktree Dashboard
          </h3>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))",
              gap: "16px",
              marginBottom: "20px",
            }}
          >
            <div
              style={{
                background: "#21262d",
                padding: "16px",
                borderRadius: "6px",
                border: "1px solid #30363d",
              }}
            >
              <h4
                style={{
                  color: "#8b949e",
                  fontSize: "12px",
                  marginBottom: "8px",
                  textTransform: "uppercase",
                }}
              >
                Branch
              </h4>
              <p style={{ color: "#e6edf3", fontSize: "16px", margin: 0 }}>
                {getBranchDisplayName(selectedWorktree.branch)}
              </p>
            </div>

            <div
              style={{
                background: "#21262d",
                padding: "16px",
                borderRadius: "6px",
                border: "1px solid #30363d",
              }}
            >
              <h4
                style={{
                  color: "#8b949e",
                  fontSize: "12px",
                  marginBottom: "8px",
                  textTransform: "uppercase",
                }}
              >
                Location
              </h4>
              <p
                style={{
                  color: "#e6edf3",
                  fontSize: "14px",
                  margin: 0,
                  fontFamily: "monospace",
                }}
              >
                {selectedWorktree.path}
              </p>
            </div>
          </div>

          <div style={{ display: "flex", gap: "12px", marginTop: "24px" }}>
            <button
              onClick={() => {
                const url = `${window.location.origin}/?worktree=${selectedWorktree.id}`;
                navigator.clipboard.writeText(url);
              }}
              style={{
                background: "#238636",
                border: "none",
                color: "#fff",
                padding: "10px 20px",
                borderRadius: "6px",
                cursor: "pointer",
                fontSize: "14px",
                display: "flex",
                alignItems: "center",
                gap: "8px",
              }}
            >
              🔗 Copy Worktree Link
            </button>
          </div>
        </div>

        {/* Agent Terminal Tab */}
        <div
          style={{
            display: activeTab === "claude" ? "flex" : "none",
            flexDirection: "column",
            flex: 1,
            minHeight: 0,
          }}
        >
          {claudeTerminalSessionId ? (
            <TerminalComponent
              key={claudeTerminalSessionId}
              sessionId={claudeTerminalSessionId}
              onClose={() => handleCloseTerminal("claude")}
            />
          ) : selectedInstance?.status === "running" ? (
            <div className="empty-terminal" style={{ flex: 1 }}>
              <div style={{ textAlign: "center" }}>
                <h4 style={{ color: "#666", marginBottom: "8px" }}>
                  {getAgentDisplayName()} Terminal
                </h4>
                {isCreatingClaudeSession ? (
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: "8px",
                      color: "#888",
                    }}
                  >
                    <div
                      style={{
                        width: "16px",
                        height: "16px",
                        border: "2px solid #444",
                        borderTop: "2px solid #888",
                        borderRadius: "50%",
                        animation: "spin 1s linear infinite",
                      }}
                    />
                    Connecting to {getAgentDisplayName()}...
                  </div>
                ) : (
                  <>
                    <p
                      style={{
                        color: "#888",
                        fontSize: "14px",
                        marginBottom: "16px",
                      }}
                    >
                      Connect to the running {getAgentDisplayName()} instance
                      for AI assistance
                    </p>
                    <button
                      onClick={handleOpenClaudeTerminal}
                      className="action-button primary"
                      style={{ fontSize: "14px", padding: "8px 16px" }}
                    >
                      Connect to {getAgentDisplayName()}
                    </button>
                  </>
                )}
              </div>
            </div>
          ) : selectedInstance?.status === "starting" ? (
            <div className="empty-terminal" style={{ flex: 1 }}>
              <div style={{ textAlign: "center" }}>
                <h4 style={{ color: "#666", marginBottom: "8px" }}>
                  {getAgentDisplayName()} Terminal
                </h4>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: "8px",
                    color: "#888",
                  }}
                >
                  <div
                    style={{
                      width: "16px",
                      height: "16px",
                      border: "2px solid #444",
                      borderTop: "2px solid #ffc107",
                      borderRadius: "50%",
                      animation: "spin 1s linear infinite",
                    }}
                  />
                  Starting {getAgentDisplayName()} instance...
                </div>
              </div>
            </div>
          ) : (
            <div className="empty-terminal" style={{ flex: 1 }}>
              <div style={{ textAlign: "center" }}>
                <h4 style={{ color: "#666", marginBottom: "8px" }}>
                  {getAgentDisplayName()} Terminal
                </h4>
                <p style={{ color: "#888", fontSize: "14px" }}>
                  {getAgentDisplayName()} instance must be running to connect
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Directory Terminal Tab */}
        <div
          style={{
            display: activeTab === "directory" ? "flex" : "none",
            flexDirection: "column",
            flex: 1,
            minHeight: 0,
          }}
        >
          {directoryTerminalSessionId ? (
            <TerminalComponent
              sessionId={directoryTerminalSessionId}
              onClose={() => handleCloseTerminal("directory")}
            />
          ) : (
            <div className="empty-terminal" style={{ flex: 1 }}>
              <div style={{ textAlign: "center" }}>
                <h4 style={{ color: "#666", marginBottom: "8px" }}>
                  Directory Terminal
                </h4>
                <p
                  style={{
                    color: "#888",
                    fontSize: "14px",
                    marginBottom: "16px",
                  }}
                >
                  Open a bash shell in the worktree directory
                </p>
                {!isCreatingDirectorySession ? (
                  <button
                    onClick={handleOpenDirectoryTerminal}
                    className="action-button primary"
                    style={{ fontSize: "14px", padding: "8px 16px" }}
                  >
                    Open Terminal
                  </button>
                ) : (
                  <div style={{ color: "#888" }}>Connecting...</div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Git Tab */}
        <div
          style={{
            display: activeTab === "git" ? "flex" : "none",
            flexDirection: "column",
            flex: 1,
            minHeight: 0,
            padding: "16px",
            overflow: "auto",
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: "16px",
              borderBottom: "1px solid #444",
              paddingBottom: "12px",
            }}
          >
            <h4 style={{ color: "#fff", margin: 0 }}>Git Changes</h4>
            <button
              onClick={loadGitDiff}
              disabled={gitLoading}
              style={{
                backgroundColor: "#007acc",
                border: "none",
                color: "#fff",
                padding: "8px 16px",
                borderRadius: "4px",
                cursor: gitLoading ? "not-allowed" : "pointer",
                fontSize: "13px",
                opacity: gitLoading ? 0.6 : 1,
              }}
            >
              {gitLoading ? "Loading..." : "Refresh"}
            </button>
          </div>

          {gitLoading ? (
            <div
              style={{ color: "#888", textAlign: "center", padding: "40px" }}
            >
              Loading git diff...
            </div>
          ) : gitDiff && gitDiff.trim() ? (
            <pre
              style={{
                background: "#0d1117",
                border: "1px solid #30363d",
                borderRadius: "6px",
                padding: "16px",
                overflow: "auto",
                fontSize: "12px",
                fontFamily:
                  'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
                color: "#e6edf3",
                whiteSpace: "pre-wrap",
                wordBreak: "break-all",
              }}
            >
              {gitDiff}
            </pre>
          ) : (
            <div
              style={{ color: "#888", textAlign: "center", padding: "40px" }}
            >
              No uncommitted changes
            </div>
          )}
        </div>
      </div>

      {/* CSS for spinner animation */}
      <style>{`
        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}
