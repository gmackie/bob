"use client";

import React, { useCallback, useEffect, useState } from "react";

import type {
  AgentInfo,
  AgentType,
  ClaudeInstance,
  Repository,
  Worktree,
} from "~/lib/legacy/types";
import { api } from "~/lib/rest/api";

interface RepositoryPanelProps {
  repositories: Repository[];
  instances: ClaudeInstance[];
  selectedWorktreeId: string | null;
  selectedRepositoryId: string | null;
  onSelectWorktree: (worktreeId: string) => Promise<void>;
  onSelectRepository: (repositoryId: string) => void;
  onCreateWorktreeAndStartInstance: (
    repositoryId: string,
    branchName: string,
    agentType?: AgentType,
  ) => void;
  onDeleteWorktree: (worktreeId: string, force: boolean) => Promise<void>;
  onRefreshMainBranch: (repositoryId: string) => Promise<void>;
  isCollapsed: boolean;
  onToggleCollapse: () => void;
  onRefreshData: () => Promise<void>;
}

export function RepositoryPanel({
  repositories,
  instances,
  selectedWorktreeId,
  selectedRepositoryId,
  onSelectWorktree,
  onSelectRepository,
  onCreateWorktreeAndStartInstance,
  onDeleteWorktree,
  onRefreshMainBranch,
  isCollapsed,
  onToggleCollapse,
  onRefreshData,
}: RepositoryPanelProps) {
  const [showNewWorktreeForm, setShowNewWorktreeForm] = useState<string | null>(
    null,
  );
  const [newBranchName, setNewBranchName] = useState("");
  const [startingInstances, setStartingInstances] = useState<Set<string>>(
    new Set(),
  );
  const [copiedWorktreeId, setCopiedWorktreeId] = useState<string | null>(null);
  const [refreshingRepositories, setRefreshingRepositories] = useState<
    Set<string>
  >(new Set());
  const [availableAgents, setAvailableAgents] = useState<AgentInfo[]>([]);
  const [selectedAgentType, setSelectedAgentType] = useState<
    AgentType | undefined
  >(undefined);
  const [showAddRepoModal, setShowAddRepoModal] = useState(false);
  const [newRepoPath, setNewRepoPath] = useState("");
  const [addingRepo, setAddingRepo] = useState(false);

  useEffect(() => {
    const fetchAgents = async () => {
      try {
        const agents = await api.getAgents();
        setAvailableAgents(agents);
        const defaultAgent = agents.find(
          (a) => a.isAvailable && (a.isAuthenticated ?? true),
        );
        if (defaultAgent) {
          setSelectedAgentType(defaultAgent.type);
        }
      } catch (error) {
        console.error("Failed to fetch available agents:", error);
        setAvailableAgents([]);
      }
    };
    fetchAgents();
  }, []);

  const getWorktreeStatus = (worktree: Worktree) => {
    const worktreeInstances = instances.filter(
      (i) => i.worktreeId === worktree.id,
    );
    if (worktreeInstances.length === 0)
      return { status: "none", label: "No Instance" };

    const instance = worktreeInstances[0];

    switch (instance?.status) {
      case "running":
        return { status: "running", label: "Running" };
      case "starting":
        return { status: "starting", label: "Starting" };
      case "error":
        return { status: "error", label: "Error" };
      case "stopped":
      default:
        return { status: "stopped", label: "Stopped" };
    }
  };

  const getBranchDisplayName = (branch: string) => {
    return branch.replace(/^refs\/heads\//, "");
  };

  const handleWorktreeSelect = async (worktreeId: string) => {
    setStartingInstances((prev) => new Set(prev).add(worktreeId));

    try {
      await onSelectWorktree(worktreeId);
    } finally {
      setTimeout(() => {
        setStartingInstances((prev) => {
          const newSet = new Set(prev);
          newSet.delete(worktreeId);
          return newSet;
        });
      }, 2000);
    }
  };

  const handleCopyWorktreeLink = async (
    worktreeId: string,
    e: React.MouseEvent,
  ) => {
    e.stopPropagation();
    const currentUrl = new URL(window.location.href);
    currentUrl.searchParams.set("worktree", worktreeId);
    const linkUrl = currentUrl.toString();

    try {
      await navigator.clipboard.writeText(linkUrl);
      setCopiedWorktreeId(worktreeId);
      setTimeout(() => setCopiedWorktreeId(null), 2000);
    } catch (err) {
      console.error("Failed to copy link:", err);
      prompt("Copy this link:", linkUrl);
    }
  };

  const handleRefreshMainBranch = async (
    repositoryId: string,
    e: React.MouseEvent,
  ) => {
    e.stopPropagation();

    setRefreshingRepositories((prev) => new Set(prev).add(repositoryId));

    try {
      await onRefreshMainBranch(repositoryId);
    } catch (error) {
      console.error("Failed to refresh main branch:", error);
    } finally {
      setRefreshingRepositories((prev) => {
        const newSet = new Set(prev);
        newSet.delete(repositoryId);
        return newSet;
      });
    }
  };

  const handleCreateWorktree = (repositoryId: string) => {
    if (newBranchName.trim()) {
      onCreateWorktreeAndStartInstance(
        repositoryId,
        newBranchName.trim(),
        selectedAgentType,
      );
      setNewBranchName("");
      setShowNewWorktreeForm(null);
    }
  };

  const handleAddRepository = async () => {
    if (!newRepoPath.trim()) return;

    setAddingRepo(true);
    try {
      await api.addRepository(newRepoPath.trim());
      await onRefreshData();
      setNewRepoPath("");
      setShowAddRepoModal(false);
    } catch (error) {
      console.error("Failed to add repository:", error);
      alert(
        `Failed to add repository: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    } finally {
      setAddingRepo(false);
    }
  };

  const getStatusColor = (status: string, isStarting: boolean) => {
    if (isStarting) return "#ffc107";
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

  return (
    <div className={`left-panel ${isCollapsed ? "collapsed" : ""}`}>
      <div className="panel-header">
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          {!isCollapsed && (
            <h3 style={{ margin: 0, color: "#ffffff" }}>Repositories</h3>
          )}
          <button
            onClick={onToggleCollapse}
            className="collapse-toggle-btn"
            title={isCollapsed ? "Expand panel" : "Collapse panel"}
            style={{
              background: "transparent",
              border: "1px solid #555",
              color: "#ffffff",
              borderRadius: "4px",
              cursor: "pointer",
              fontSize: "14px",
              padding: "4px 8px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: "28px",
              height: "28px",
            }}
          >
            {isCollapsed ? "▶" : "◀"}
          </button>
        </div>
      </div>

      {!isCollapsed && (
        <>
          <div className="add-repo-section">
            <button
              onClick={() => setShowAddRepoModal(true)}
              className="add-repo-btn"
            >
              <span>+</span>
              Add Repository
            </button>
          </div>

          <div className="panel-content">
            {repositories.length === 0 ? (
              <div
                style={{
                  textAlign: "center",
                  color: "#666",
                  marginTop: "40px",
                }}
              >
                <p>No repositories added</p>
                <p style={{ fontSize: "12px" }}>
                  Click &quot;Add Repository&quot; to get started
                </p>
              </div>
            ) : (
              <div className="repository-list">
                {repositories.map((repo) => (
                  <div key={repo.id} className="repository-item">
                    <div className="repository-header">
                      <div className="repository-info">
                        <h4
                          onClick={(e) => {
                            e.stopPropagation();
                            onSelectRepository(repo.id);
                          }}
                          style={{
                            cursor: "pointer",
                            color:
                              selectedRepositoryId === repo.id
                                ? "#79c0ff"
                                : "#58a6ff",
                            margin: 0,
                            transition: "color 0.2s ease",
                          }}
                          title="View repository dashboard"
                        >
                          {repo.name} 📊
                        </h4>
                        <p>{repo.path}</p>
                        <div
                          style={{
                            fontSize: "12px",
                            color: "#888",
                            marginTop: "4px",
                            display: "flex",
                            alignItems: "center",
                            gap: "8px",
                          }}
                        >
                          <span>
                            Main: <strong>{repo.mainBranch}</strong>
                          </span>
                          <button
                            onClick={(e) => handleRefreshMainBranch(repo.id, e)}
                            disabled={refreshingRepositories.has(repo.id)}
                            style={{
                              background: "#6c757d",
                              color: "#fff",
                              border: "none",
                              padding: "2px 6px",
                              borderRadius: "3px",
                              cursor: refreshingRepositories.has(repo.id)
                                ? "not-allowed"
                                : "pointer",
                              fontSize: "10px",
                              opacity: refreshingRepositories.has(repo.id)
                                ? 0.6
                                : 1,
                            }}
                            title={
                              refreshingRepositories.has(repo.id)
                                ? "Refreshing..."
                                : "Refresh main branch"
                            }
                          >
                            {refreshingRepositories.has(repo.id) ? "↻" : "⟳"}
                          </button>
                        </div>
                      </div>
                      <button
                        onClick={() => setShowNewWorktreeForm(repo.id)}
                        className="add-worktree-btn"
                        title="Create new worktree and start agent instance"
                      >
                        +
                      </button>
                    </div>

                    {showNewWorktreeForm === repo.id && (
                      <div
                        style={{
                          padding: "12px 16px",
                          background: "#2a2a2a",
                          borderTop: "1px solid #444",
                        }}
                      >
                        <div
                          style={{
                            display: "flex",
                            flexDirection: "column",
                            gap: "8px",
                          }}
                        >
                          <input
                            type="text"
                            value={newBranchName}
                            onChange={(e) => setNewBranchName(e.target.value)}
                            placeholder="Branch name (e.g., feature-xyz)"
                            className="input"
                            style={{ fontSize: "12px", padding: "6px 8px" }}
                            onKeyDown={(e) =>
                              e.key === "Enter" && handleCreateWorktree(repo.id)
                            }
                            autoFocus
                          />
                          <div
                            style={{
                              display: "flex",
                              gap: "8px",
                              alignItems: "center",
                            }}
                          >
                            <select
                              value={selectedAgentType ?? ""}
                              onChange={(e) =>
                                setSelectedAgentType(
                                  e.target.value as AgentType | undefined,
                                )
                              }
                              className="input"
                              style={{ flex: 1, fontSize: "12px" }}
                            >
                              <option value="">Select Agent</option>
                              {availableAgents
                                .filter((a) => a.isAvailable)
                                .map((agent) => (
                                  <option key={agent.type} value={agent.type}>
                                    {agent.name}
                                    {agent.isAuthenticated === false
                                      ? " (needs auth)"
                                      : ""}
                                  </option>
                                ))}
                            </select>
                            <button
                              onClick={() => handleCreateWorktree(repo.id)}
                              disabled={!newBranchName.trim()}
                              className="button"
                              style={{ fontSize: "12px", padding: "6px 12px" }}
                            >
                              Create
                            </button>
                            <button
                              onClick={() => {
                                setShowNewWorktreeForm(null);
                                setNewBranchName("");
                              }}
                              className="button secondary"
                              style={{ fontSize: "12px", padding: "6px 12px" }}
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      </div>
                    )}

                    {repo.worktrees.length > 0 && (
                      <div className="worktrees-list">
                        {repo.worktrees.map((worktree) => {
                          const status = getWorktreeStatus(worktree);
                          const isSelected = selectedWorktreeId === worktree.id;
                          const isStarting = startingInstances.has(worktree.id);

                          return (
                            <div
                              key={worktree.id}
                              className={`worktree-item ${isSelected ? "active" : ""}`}
                            >
                              <div
                                onClick={() =>
                                  handleWorktreeSelect(worktree.id)
                                }
                                style={{
                                  cursor: "pointer",
                                  flex: 1,
                                  display: "flex",
                                  justifyContent: "space-between",
                                  alignItems: "center",
                                }}
                              >
                                <div className="worktree-info">
                                  <div className="worktree-name">
                                    {getBranchDisplayName(worktree.branch)}
                                  </div>
                                  <div className="worktree-path">
                                    {worktree.path}
                                  </div>
                                </div>
                                <div
                                  className={`instance-status ${isStarting ? "starting" : status.status}`}
                                  style={{
                                    backgroundColor: getStatusColor(
                                      status.status,
                                      isStarting,
                                    ),
                                    color:
                                      isStarting || status.status === "starting"
                                        ? "#000"
                                        : "#fff",
                                  }}
                                >
                                  {isStarting ? "Starting..." : status.label}
                                </div>
                              </div>
                              <button
                                onClick={(e) =>
                                  handleCopyWorktreeLink(worktree.id, e)
                                }
                                style={{
                                  background:
                                    copiedWorktreeId === worktree.id
                                      ? "#28a745"
                                      : "#6c757d",
                                  color: "#fff",
                                  border: "none",
                                  padding: "4px 8px",
                                  borderRadius: "3px",
                                  cursor: "pointer",
                                  fontSize: "12px",
                                  marginLeft: "8px",
                                  flexShrink: 0,
                                }}
                                title={
                                  copiedWorktreeId === worktree.id
                                    ? "Link copied!"
                                    : "Copy direct link to this worktree"
                                }
                              >
                                {copiedWorktreeId === worktree.id ? "✓" : "🔗"}
                              </button>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  if (
                                    confirm(
                                      `Delete worktree "${getBranchDisplayName(worktree.branch)}"?`,
                                    )
                                  ) {
                                    onDeleteWorktree(worktree.id, false);
                                  }
                                }}
                                style={{
                                  background: "#dc3545",
                                  color: "#fff",
                                  border: "none",
                                  padding: "4px 8px",
                                  borderRadius: "3px",
                                  cursor: "pointer",
                                  fontSize: "12px",
                                  marginLeft: "8px",
                                  flexShrink: 0,
                                }}
                                title="Delete worktree"
                              >
                                ×
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}

      {isCollapsed && repositories.length > 0 && (
        <div className="collapsed-content">
          {repositories.map((repo) =>
            repo.worktrees.map((worktree) => {
              const status = getWorktreeStatus(worktree);
              const isSelected = selectedWorktreeId === worktree.id;
              const isStarting = startingInstances.has(worktree.id);

              return (
                <div
                  key={worktree.id}
                  className={`collapsed-worktree-item ${isSelected ? "active" : ""}`}
                  onClick={() => handleWorktreeSelect(worktree.id)}
                  title={`${getBranchDisplayName(worktree.branch)} - ${worktree.path}`}
                  style={{
                    padding: "8px 12px",
                    margin: "4px 0",
                    borderRadius: "4px",
                    cursor: "pointer",
                    background: isSelected ? "#007acc" : "#2a2a2a",
                    border: "1px solid #444",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    flexDirection: "column",
                    gap: "4px",
                  }}
                >
                  <div
                    style={{
                      fontSize: "11px",
                      fontWeight: "bold",
                      color: "#fff",
                      textAlign: "center",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                      width: "100%",
                    }}
                  >
                    {getBranchDisplayName(worktree.branch)}
                  </div>
                  <div
                    style={{
                      fontSize: "8px",
                      padding: "1px 4px",
                      borderRadius: "2px",
                      backgroundColor: getStatusColor(
                        status.status,
                        isStarting,
                      ),
                      color:
                        isStarting || status.status === "starting"
                          ? "#000"
                          : "#fff",
                    }}
                  >
                    {isStarting ? "Starting..." : status.label}
                  </div>
                </div>
              );
            }),
          )}
        </div>
      )}

      {showAddRepoModal && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: "rgba(0, 0, 0, 0.8)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
          }}
        >
          <div
            style={{
              backgroundColor: "#1e1e1e",
              borderRadius: "8px",
              border: "1px solid #333",
              padding: "24px",
              width: "90%",
              maxWidth: "500px",
            }}
          >
            <h3 style={{ margin: "0 0 16px 0", color: "#fff" }}>
              Add Repository
            </h3>
            <input
              type="text"
              value={newRepoPath}
              onChange={(e) => setNewRepoPath(e.target.value)}
              placeholder="Enter repository path (e.g., /path/to/repo)"
              className="input"
              style={{ width: "100%", marginBottom: "16px" }}
              onKeyDown={(e) => e.key === "Enter" && handleAddRepository()}
              autoFocus
            />
            <div
              style={{
                display: "flex",
                gap: "8px",
                justifyContent: "flex-end",
              }}
            >
              <button
                onClick={() => {
                  setShowAddRepoModal(false);
                  setNewRepoPath("");
                }}
                className="button secondary"
                disabled={addingRepo}
              >
                Cancel
              </button>
              <button
                onClick={handleAddRepository}
                className="button"
                disabled={!newRepoPath.trim() || addingRepo}
              >
                {addingRepo ? "Adding..." : "Add"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
