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

  const getWorktreeDotClass = (status: string) => {
    if (status === "running") return "is-running";
    if (status === "starting") return "is-warning";
    if (status === "error") return "is-danger";
    return "is-muted";
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

  return (
    <div className={`left-panel ${isCollapsed ? "collapsed" : ""}`}>
      <div className="panel-header">
        <div className="dash-repoPanelHeaderBar">
          {!isCollapsed && <h3 className="dash-repoPanelHeaderTitle">Repositories</h3>}
          <button
            onClick={onToggleCollapse}
            className="collapse-toggle-btn dash-repoPanelToggle"
            title={isCollapsed ? "Expand panel" : "Collapse panel"}
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
              <div className="dash-repoPanelEmpty">
                <div>No repositories added</div>
                <p>Click “Add Repository” to get started</p>
              </div>
            ) : (
              <div className="dash-repoPanelStack">
                {repositories.map((repo) => (
                  <article
                    key={repo.id}
                    className={`dash-repoPanelCard ${selectedRepositoryId === repo.id ? "is-selected" : ""}`}
                  >
                    <header className="dash-repoPanelHeader">
                      <button
                        type="button"
                        className="dash-repoPanelTitleButton"
                        onClick={(e) => {
                          e.stopPropagation();
                          onSelectRepository(repo.id);
                        }}
                        title="View repository dashboard"
                      >
                        <h4 className="dash-repoPanelName">
                          {repo.name}
                        </h4>
                        <p className="dash-repoPanelPath">{repo.path}</p>
                        <div className="dash-repoPanelMetaRow">
                          <span>
                            Main: <strong>{repo.mainBranch}</strong>
                          </span>
                          <button
                            type="button"
                            onClick={(e) => handleRefreshMainBranch(repo.id, e)}
                            disabled={refreshingRepositories.has(repo.id)}
                            className="dash-repoPanelRefreshBtn"
                            title={
                              refreshingRepositories.has(repo.id)
                                ? "Refreshing..."
                                : "Refresh main branch"
                            }
                          >
                            {refreshingRepositories.has(repo.id) ? "↻" : "⟳"}
                          </button>
                        </div>
                      </button>
                      <button
                        type="button"
                        onClick={() => setShowNewWorktreeForm(repo.id)}
                        className="dash-repoPanelAddBtn"
                        title="Create new worktree and start agent instance"
                      >
                        +
                      </button>
                    </header>

                    {showNewWorktreeForm === repo.id && (
                      <div className="dash-repoPanelForm">
                        <div className="dash-repoPanelFormInner">
                          <input
                            type="text"
                            value={newBranchName}
                            onChange={(e) => setNewBranchName(e.target.value)}
                            placeholder="Branch name (e.g., feature-xyz)"
                            className="dash-repoPanelInput dash-repoPanelFormField"
                            onKeyDown={(e) =>
                              e.key === "Enter" && handleCreateWorktree(repo.id)
                            }
                            autoFocus
                          />
                          <div className="dash-repoPanelFormRow">
                            <select
                              value={selectedAgentType ?? ""}
                              onChange={(e) =>
                                setSelectedAgentType(
                                  e.target.value as AgentType | undefined,
                                )
                              }
                              className="dash-repoPanelInput dash-repoPanelFormField"
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
                              type="button"
                              onClick={() => handleCreateWorktree(repo.id)}
                              disabled={!newBranchName.trim()}
                              className="dash-repoPanelAction"
                            >
                              Create
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setShowNewWorktreeForm(null);
                                setNewBranchName("");
                              }}
                              className="dash-repoPanelAction dash-repoPanelActionSecondary"
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      </div>
                    )}

                    <div className="dash-repoWorktreeRail">
                      {repo.worktrees.length === 0 ? (
                        <div className="dash-emptyState">No worktrees yet</div>
                      ) : (
                        repo.worktrees.map((worktree) => {
                          const status = getWorktreeStatus(worktree);
                          const isSelected = selectedWorktreeId === worktree.id;
                          const isStarting = startingInstances.has(worktree.id);

                          return (
                            <div
                              key={worktree.id}
                              className="dash-repoWorktreeRow"
                            >
                              <button
                                type="button"
                                className={`dash-liveSessionChip ${
                                  isSelected ? "is-active" : ""
                                }`}
                                onClick={() =>
                                  handleWorktreeSelect(worktree.id)
                                }
                              >
                                <span
                                  className={`dash-sessionDot ${getWorktreeDotClass(
                                    status.status,
                                  )}`}
                                />
                                <span className="dash-liveSessionChipInfo">
                                  <span>
                                    {getBranchDisplayName(worktree.branch)}
                                  </span>
                                  <span className="dash-terminalSessionSubline">
                                    {worktree.path}
                                  </span>
                                  <span className="dash-terminalSessionSubline">
                                    {isStarting ? "Starting..." : status.label}
                                  </span>
                                </span>
                                <span className="dash-sessionAction">
                                  {isStarting ? "Opening..." : "Open"}
                                </span>
                              </button>
                              <div className="dash-repoWorktreeActions">
                                <button
                                  type="button"
                                  onClick={(e) =>
                                    handleCopyWorktreeLink(worktree.id, e)
                                  }
                                  className={`dash-repoWorktreeAction ${
                                    copiedWorktreeId === worktree.id
                                      ? "is-copied"
                                      : ""
                                  }`}
                                  title={
                                    copiedWorktreeId === worktree.id
                                      ? "Link copied!"
                                      : "Copy direct link to this worktree"
                                  }
                                >
                                  {copiedWorktreeId === worktree.id
                                    ? "✓"
                                    : "🔗"}
                                </button>
                                <button
                                  type="button"
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
                                  className="dash-repoWorktreeAction is-danger"
                                  title="Delete worktree"
                                >
                                  ×
                                </button>
                              </div>
                            </div>
                          );
                        })
                      )}
                    </div>
                  </article>
                ))}
              </div>
            )}
          </div>
        </>
      )}

      {isCollapsed && repositories.length > 0 && (
        <div className="collapsed-content">
          {repositories.every((repo) => repo.worktrees.length === 0) ? (
            <div className="dash-emptyState">No worktrees yet</div>
          ) : (
            repositories.map((repo) =>
              repo.worktrees.map((worktree) => {
                const status = getWorktreeStatus(worktree);
                const isSelected = selectedWorktreeId === worktree.id;
                const isStarting = startingInstances.has(worktree.id);
                return (
                  <button
                    key={`${repo.id}-${worktree.id}`}
                    type="button"
                    className={`dash-collapsedWorktreeItem ${
                      isSelected ? "is-active" : ""
                    }`}
                    onClick={() => handleWorktreeSelect(worktree.id)}
                    title={`${getBranchDisplayName(worktree.branch)} - ${worktree.path}`}
                  >
                    <span
                      className={`dash-sessionDot ${getWorktreeDotClass(status.status)}`}
                    />
                    <div className="dash-collapsedWorktreeText">
                      <span className="dash-collapsedWorktreeName">
                        {getBranchDisplayName(worktree.branch)}
                      </span>
                      <span className="dash-collapsedWorktreeMeta">
                        {repo.name}
                      </span>
                    </div>
                    <span className="dash-collapsedWorktreeStatus">
                      {isStarting ? "Starting..." : status.label}
                    </span>
                  </button>
                );
              }),
            )
          )}
        </div>
      )}

      {showAddRepoModal && (
        <div
          className="dash-repoModalBackdrop"
        >
          <div
            className="dash-repoModalCard"
          >
            <h3 className="dash-repoModalTitle">
              Add Repository
            </h3>
            <input
              type="text"
              value={newRepoPath}
              onChange={(e) => setNewRepoPath(e.target.value)}
              placeholder="Enter repository path (e.g., /path/to/repo)"
              className="dash-repoPanelInput dash-repoModalInput"
              onKeyDown={(e) => e.key === "Enter" && handleAddRepository()}
              autoFocus
            />
            <div
              className="dash-repoModalFooter"
            >
              <button
                onClick={() => {
                  setShowAddRepoModal(false);
                  setNewRepoPath("");
                }}
                className="dash-repoPanelAction dash-repoPanelActionSecondary"
                disabled={addingRepo}
              >
                Cancel
              </button>
              <button
                onClick={handleAddRepository}
                className="dash-repoPanelAction"
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
