"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";

import type { ClaudeInstance, Worktree } from "~/lib/legacy/types";
import { api } from "~/lib/rest/api";
import { SystemStatusPanel } from "./SystemStatusPanel";
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

type SessionType = "claude" | "directory";

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

  const [gitDiff, setGitDiff] = useState<string>("");
  const [gitLoading, setGitLoading] = useState(false);

  const sessionCacheRef = useRef<
    Map<string, { claude: string | null; directory: string | null }>
  >(new Map());

  useEffect(() => {
    setClaudeTerminalSessionId(null);
    setDirectoryTerminalSessionId(null);
    setGitDiff("");
    setActiveTab("dashboard");
    setIsCreatingClaudeSession(false);
    setIsCreatingDirectorySession(false);
  }, [selectedInstance?.id]);

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

  const getBranchDisplayName = (branch: string) => {
    return branch.replace(/^refs\/heads\//, "");
  };

  const getStatusClass = (status: string) => {
    switch (status) {
      case "running":
        return "is-running";
      case "starting":
        return "is-warning";
      case "error":
        return "is-danger";
      case "stopped":
        return "is-muted";
      default:
        return "is-muted";
    }
  };

  const getInstanceDisplayName = () => {
    if (!selectedInstance) return "Idle";
    const agentType = selectedInstance.agentType || "claude";
    return agentType.charAt(0).toUpperCase() + agentType.slice(1);
  };

  const handleOpenClaudeTerminal = useCallback(async () => {
    if (!selectedInstance || selectedInstance.status !== "running") return;

    setIsCreatingClaudeSession(true);
    try {
      const existingSessions = await api.getTerminalSessions(selectedInstance.id);
      const claudeSession = existingSessions.find((s) => s.type === "claude");

      if (claudeSession) {
        setClaudeTerminalSessionId(claudeSession.id);
      } else {
        const { sessionId } = await api.createTerminalSession(selectedInstance.id);
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
      const existingSessions = await api.getTerminalSessions(selectedInstance.id);
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
    async (terminalType: SessionType) => {
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

  useEffect(() => {
    if (activeTab === "git" && selectedWorktree) {
      loadGitDiff();
    }
  }, [activeTab, selectedWorktree?.id]);

  const handleOpenSession = useCallback(
    (session: SessionType) => {
      setActiveTab(session);
      if (session === "claude" && !claudeTerminalSessionId) {
        if (selectedInstance?.status === "running") {
          setTimeout(() => {
            void handleOpenClaudeTerminal();
          }, 80);
        }
        return;
      }

      if (session === "directory" && !directoryTerminalSessionId) {
        setTimeout(() => {
          void handleOpenDirectoryTerminal();
        }, 80);
      }
    },
    [
      claudeTerminalSessionId,
      directoryTerminalSessionId,
      selectedInstance?.status,
      handleOpenClaudeTerminal,
      handleOpenDirectoryTerminal,
    ],
  );

  if (!selectedWorktree) {
    return (
      <div
        className={`dash-agentPanel ${
          isLeftPanelCollapsed ? "is-collapsed" : "is-expanded"
        }`}
      >
        <div className="dash-agentPanelContent">
          <SystemStatusPanel />
          <div className="dash-agentEmptyState" style={{ flex: 1 }}>
            <div className="dash-agentEmptyStateInner">
              <h3 className="dash-agentEmptyStateTitle">Select a worktree</h3>
              <p>Pick one from the left panel to continue.</p>
              <p>
                Add repositories with the <strong>Add Repository</strong> action to
                get started.
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const isInstanceRunning = selectedInstance?.status === "running";
  const canStartTerminal = selectedInstance?.status === "running";

  return (
    <div
      className="dash-agentPanel"
      style={{
        width: isLeftPanelCollapsed
          ? "calc(100% - 60px)"
          : "calc(100% - 360px)",
      }}
    >
      <div className="dash-agentPanelHeader">
        <div className="dash-agentPanelHeaderTop">
          <div className="dash-agentPanelIdentity">
            <div className="dash-agentPanelTitleRow">
              <h2 className="dash-agentPanelTitle">
                {getInstanceDisplayName()} Instance
              </h2>
              <span
                className={`dash-agentPanelStatus ${selectedInstance ? getStatusClass(selectedInstance.status) : "is-muted"}`}
              >
                {selectedInstance ? selectedInstance.status : "idle"}
              </span>
            </div>
            <div className="dash-agentPanelMeta">
              <span>{getBranchDisplayName(selectedWorktree.branch)}</span>
              <span className="dash-agentPanelMetaDot">•</span>
              <span className="dash-truncateText">{selectedWorktree.path}</span>
            </div>
          </div>

          <div className="dash-agentPanelActions">
            {isInstanceRunning && (
              <button
                className="dash-agentPanelAction is-danger"
                onClick={handleStopInstance}
                disabled={isStopping}
              >
                {isStopping ? "Stopping..." : `Stop ${getInstanceDisplayName()}`}
              </button>
            )}

            {(selectedInstance?.status === "stopped" ||
              selectedInstance?.status === "error") && (
              <button
                className="dash-agentPanelAction"
                onClick={handleRestartInstance}
                disabled={isRestarting}
              >
                {isRestarting
                  ? "Restarting..."
                  : `Restart ${getInstanceDisplayName()}`}
              </button>
            )}

            {!selectedInstance && (
              <button
                className="dash-agentPanelAction is-primary"
                onClick={() => onStartInstance(selectedWorktree.id)}
              >
                ▶ Start Agent
              </button>
            )}

            <button
              className="dash-agentPanelAction is-danger"
              onClick={() => {
                const confirmed = confirm(
                  `Delete worktree "${getBranchDisplayName(selectedWorktree.branch)}"?`,
                );
                if (confirmed) {
                  onDeleteWorktree(selectedWorktree.id, false);
                }
              }}
            >
              Delete worktree
            </button>
          </div>
        </div>

        <div className="dash-agentDockRow">
          <div className="dash-agentDockTitle">Session shortcuts</div>
          <div className="dash-agentDockChips">
            <div className="dash-agentSessionChipWrap">
              <button
                className={`dash-agentSessionChip ${
                  activeTab === "claude" ? "is-active" : ""
                }`}
                onClick={() => handleOpenSession("claude")}
              >
                <span
                  className={`dash-sessionDot ${
                    isInstanceRunning ? "is-running" : "is-muted"
                  }`}
                />
                <span className="dash-agentSessionChipInfo">
                  <span className="dash-agentSessionChipTitle">
                    {getInstanceDisplayName()} Terminal
                  </span>
                  <span className="dash-agentSessionChipSubline">
                    {claudeTerminalSessionId
                      ? `Active ${claudeTerminalSessionId.slice(-8)}`
                      : isInstanceRunning
                        ? isCreatingClaudeSession
                          ? "Connecting"
                          : "Not connected"
                        : "Unavailable"}
                  </span>
                </span>
              </button>
              {claudeTerminalSessionId ? (
                <button
                  className="dash-agentSessionChipClose"
                  onClick={() => {
                    void handleCloseTerminal("claude");
                  }}
                  title="Close Claude terminal session"
                >
                  ×
                </button>
              ) : null}
            </div>

            <div className="dash-agentSessionChipWrap">
              <button
                className={`dash-agentSessionChip ${
                  activeTab === "directory" ? "is-active" : ""
                }`}
                onClick={() => handleOpenSession("directory")}
              >
                <span className={`dash-sessionDot ${selectedInstance ? "is-muted" : "is-muted"}`} />
                <span className="dash-agentSessionChipInfo">
                  <span className="dash-agentSessionChipTitle">
                    Directory Terminal
                  </span>
                  <span className="dash-agentSessionChipSubline">
                    {directoryTerminalSessionId
                      ? `Active ${directoryTerminalSessionId.slice(-8)}`
                      : selectedInstance
                        ? isCreatingDirectorySession
                          ? "Connecting"
                          : "Not connected"
                        : "Unavailable"}
                  </span>
                </span>
              </button>
              {directoryTerminalSessionId ? (
                <button
                  className="dash-agentSessionChipClose"
                  onClick={() => {
                    void handleCloseTerminal("directory");
                  }}
                  title="Close directory terminal session"
                >
                  ×
                </button>
              ) : null}
            </div>
          </div>
        </div>
      </div>

      {error ? <div className="dash-agentPanelError">{error}</div> : null}

      <div className="dash-agentTabs" role="tablist" aria-label="Worktree views">
        <button
          className={`dash-agentTab ${activeTab === "dashboard" ? "is-active" : ""}`}
          onClick={() => setActiveTab("dashboard")}
          aria-label="Dashboard tab"
        >
          Dashboard
        </button>
        <button
          className={`dash-agentTab ${activeTab === "claude" ? "is-active" : ""}`}
          onClick={() => {
            handleOpenSession("claude");
            setActiveTab("claude");
          }}
          disabled={!selectedInstance || !canStartTerminal}
          aria-label="Claude tab"
        >
          {getInstanceDisplayName()} Terminal
          {claudeTerminalSessionId ? " • open" : ""}
        </button>
        <button
          className={`dash-agentTab ${activeTab === "directory" ? "is-active" : ""}`}
          onClick={() => {
            handleOpenSession("directory");
            setActiveTab("directory");
          }}
          aria-label="Directory terminal tab"
        >
          Directory Terminal
          {directoryTerminalSessionId ? " • open" : ""}
        </button>
        <button
          className={`dash-agentTab ${activeTab === "git" ? "is-active" : ""}`}
          onClick={() => setActiveTab("git")}
          aria-label="Git diff tab"
        >
          Git
          {gitDiff && gitDiff.trim() ? " • changes" : ""}
        </button>
      </div>

      <div className="dash-agentPanelContent">
        <div
          className={`dash-agentTabPanel ${
            activeTab === "dashboard" ? "is-visible" : ""
          }`}
        >
          <div className="dash-agentKpiGrid">
            <article className="dash-agentKpiCard">
              <h3 className="dash-agentKpiLabel">Branch</h3>
              <p className="dash-agentKpiValue">
                {getBranchDisplayName(selectedWorktree.branch)}
              </p>
            </article>
            <article className="dash-agentKpiCard">
              <h3 className="dash-agentKpiLabel">Location</h3>
              <p className="dash-agentKpiCode">{selectedWorktree.path}</p>
            </article>
            <article className="dash-agentKpiCard">
              <h3 className="dash-agentKpiLabel">Instance</h3>
              <p className="dash-agentKpiValue">
                {selectedInstance
                  ? `${getInstanceDisplayName()}`
                  : "Not started"}
              </p>
            </article>
            <article className="dash-agentKpiCard">
              <h3 className="dash-agentKpiLabel">Worktree</h3>
              <p className="dash-agentKpiCode">{selectedWorktree.id}</p>
            </article>
          </div>

          <div className="dash-agentActionRow">
            <button
              className="dash-agentPanelAction is-success"
              onClick={() => {
                const url = `${window.location.origin}/?worktree=${selectedWorktree.id}`;
                void navigator.clipboard.writeText(url);
              }}
            >
              🔗 Copy worktree deep-link
            </button>
            <button
              className="dash-agentPanelAction"
              onClick={() => setActiveTab("git")}
            >
              Inspect git changes
            </button>
            <button
              className="dash-agentPanelAction"
              onClick={() => setActiveTab("claude")}
              disabled={!selectedInstance}
            >
              Open console
            </button>
          </div>
        </div>

        <div
          className={`dash-agentTabPanel ${
            activeTab === "claude" ? "is-visible" : ""
          }`}
        >
          {claudeTerminalSessionId ? (
            <TerminalComponent
              key={claudeTerminalSessionId}
              sessionId={claudeTerminalSessionId}
              onClose={() => {
                void handleCloseTerminal("claude");
              }}
            />
          ) : isInstanceRunning ? (
            <div className="dash-emptyStateWrapper">
              {isCreatingClaudeSession ? (
                <div className="dash-agentSpinnerRow">
                  <span className="dash-spinner" aria-hidden="true" />
                  <p>Connecting to {getInstanceDisplayName()} terminal...</p>
                </div>
              ) : (
                <>
                  <h3 className="dash-agentEmptyStateTitle">
                    Claude terminal unavailable
                  </h3>
                  <p className="dash-agentEmptyStateBody">
                    Instance is running. Open a fresh session to continue.
                  </p>
                  <button
                    className="dash-agentPanelAction is-success"
                    onClick={handleOpenClaudeTerminal}
                  >
                    Connect terminal
                  </button>
                </>
              )}
            </div>
          ) : (
            <div className="dash-emptyStateWrapper">
              <h3 className="dash-agentEmptyStateTitle">
                {getInstanceDisplayName()} terminal unavailable
              </h3>
              <p className="dash-agentEmptyStateBody">
                Start the instance to launch a session.
              </p>
              {!selectedInstance ? (
                <button
                  className="dash-agentPanelAction is-primary"
                  onClick={() => onStartInstance(selectedWorktree.id)}
                >
                  Start agent
                </button>
              ) : null}
            </div>
          )}
        </div>

        <div
          className={`dash-agentTabPanel ${
            activeTab === "directory" ? "is-visible" : ""
          }`}
        >
          {directoryTerminalSessionId ? (
            <TerminalComponent
              key={directoryTerminalSessionId}
              sessionId={directoryTerminalSessionId}
              onClose={() => {
                void handleCloseTerminal("directory");
              }}
            />
          ) : (
            <div className="dash-emptyStateWrapper">
              {selectedInstance ? (
                <>
                  <h3 className="dash-agentEmptyStateTitle">
                    Directory terminal unavailable
                  </h3>
                  <p className="dash-agentEmptyStateBody">
                    This gives shell access to the selected worktree path.
                  </p>
                  {!isCreatingDirectorySession ? (
                    <button
                      className="dash-agentPanelAction is-success"
                      onClick={handleOpenDirectoryTerminal}
                    >
                      Open directory shell
                    </button>
                  ) : (
                    <div className="dash-agentSpinnerRow">
                      <span className="dash-spinner" aria-hidden="true" />
                      <p>Connecting shell...</p>
                    </div>
                  )}
                </>
              ) : (
                <div className="dash-agentEmptyStateTitle">No instance</div>
              )}
            </div>
          )}
        </div>

        <div
          className={`dash-agentTabPanel ${
            activeTab === "git" ? "is-visible" : ""
          }`}
        >
          <div className="dash-agentGitHeader">
            <h3 className="dash-agentGitHeaderTitle">Git changes</h3>
            <button
              className="dash-agentPanelAction"
              onClick={loadGitDiff}
              disabled={gitLoading}
            >
              {gitLoading ? "Loading..." : "Refresh"}
            </button>
          </div>

          {gitLoading ? (
            <div className="dash-agentEmptyStateWrapper">Loading diff...</div>
          ) : gitDiff && gitDiff.trim() ? (
            <pre className="dash-agentGitDiff">{gitDiff}</pre>
          ) : (
            <div className="dash-agentEmptyStateWrapper">No uncommitted changes.</div>
          )}
        </div>
      </div>
    </div>
  );
}
