"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import type {
  AgentType,
  ClaudeInstance,
  Repository,
  Worktree,
} from "~/lib/legacy/types";
import {
  AgentPanel,
  RepositoryDashboardPanel,
  RepositoryPanel,
  SystemStatusPanel,
} from "~/components/dashboard";
import { useCheatCode } from "~/contexts";
import { getAppConfig } from "~/lib/legacy/config";
import { api } from "~/lib/rest/api";

function DashboardContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const { isDatabaseUnlocked } = useCheatCode();

  const [repositories, setRepositories] = useState<Repository[]>([]);
  const [instances, setInstances] = useState<ClaudeInstance[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [instanceError, setInstanceError] = useState<string | null>(null);
  const [selectedWorktreeId, setSelectedWorktreeId] = useState<string | null>(
    null,
  );
  const [selectedRepositoryId, setSelectedRepositoryId] = useState<
    string | null
  >(null);
  const [isLeftPanelCollapsed, setIsLeftPanelCollapsed] = useState(false);
  const [appName, setAppName] = useState("Bob");

  const loadData = useCallback(async () => {
    try {
      const [reposData, instancesData] = await Promise.all([
        api.getRepositories(),
        api.getInstances(),
      ]);
      setRepositories(reposData);
      setInstances(instancesData);
      setError(null);
    } catch (err) {
      console.error("Failed to load data:", err);
      setError(err instanceof Error ? err.message : "Failed to load data");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    getAppConfig().then((config) => {
      setAppName(config.appName);
    });

    loadData();
    const interval = setInterval(loadData, 5000);
    return () => clearInterval(interval);
  }, [loadData]);

  useEffect(() => {
    const worktreeParam = searchParams.get("worktree");
    const repositoryParam = searchParams.get("repository");

    if (repositoryParam) {
      if (repositories.length > 0) {
        const targetRepo = repositories.find((r) => r.id === repositoryParam);
        if (targetRepo && selectedRepositoryId !== repositoryParam) {
          setSelectedRepositoryId(repositoryParam);
          setSelectedWorktreeId(null);
        }
      }
      return;
    }

    if (worktreeParam) {
      if (repositories.length > 0) {
        const allWorktrees = repositories.flatMap((repo) => repo.worktrees);
        const targetWorktree = allWorktrees.find((w) => w.id === worktreeParam);
        if (targetWorktree && selectedWorktreeId !== worktreeParam) {
          setSelectedWorktreeId(worktreeParam);
          setSelectedRepositoryId(null);
        }
      }
      return;
    }

    if (selectedWorktreeId) {
      setSelectedWorktreeId(null);
    }
    if (selectedRepositoryId) {
      setSelectedRepositoryId(null);
    }
  }, [repositories, searchParams, selectedRepositoryId, selectedWorktreeId]);

  const updateUrlWithSelection = (key: string, value: string | null) => {
    const params = new URLSearchParams(searchParams.toString());
    if (value) {
      params.set(key, value);
    } else {
      params.delete(key);
    }
    const queryString = params.toString();
    router.push(queryString ? `${pathname}?${queryString}` : pathname);
  };

  const handleSelectWorktree = async (worktreeId: string) => {
    setSelectedWorktreeId(worktreeId);
    setSelectedRepositoryId(null);
    updateUrlWithSelection("worktree", worktreeId);
    await loadData();
  };

  const handleSelectRepository = (repositoryId: string) => {
    setSelectedRepositoryId(repositoryId);
    setSelectedWorktreeId(null);
    updateUrlWithSelection("repository", repositoryId);
  };

  const handleCreateWorktreeAndStartInstance = async (
    repositoryId: string,
    branchName: string,
    agentType?: AgentType,
  ) => {
    try {
      const worktree = await api.createWorktree(repositoryId, branchName);
      await api.startInstance(worktree.id, agentType);
      await loadData();
      setSelectedWorktreeId(worktree.id);
      setError(null);
      setInstanceError(null);
    } catch (err) {
      setInstanceError(
        err instanceof Error
          ? err.message
          : "Failed to create worktree and start instance",
      );
      setTimeout(() => setInstanceError(null), 10000);
    }
  };

  const handleDeleteWorktree = async (worktreeId: string, force: boolean) => {
    try {
      await api.removeWorktree(worktreeId, force);
      await loadData();

      if (selectedWorktreeId === worktreeId) {
        setSelectedWorktreeId(null);
        updateUrlWithSelection("worktree", null);
      }

      setError(null);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to delete worktree",
      );
      throw err;
    }
  };

  const handleRefreshMainBranch = async (repositoryId: string) => {
    try {
      await api.refreshMainBranch(repositoryId);
      await loadData();
      setError(null);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to refresh main branch",
      );
    }
  };

  const handleRestartInstance = async (instanceId: string) => {
    try {
      await api.restartInstance(instanceId);
      await loadData();
      setInstanceError(null);
    } catch (err) {
      setInstanceError(
        err instanceof Error ? err.message : "Failed to restart instance",
      );
      setTimeout(() => setInstanceError(null), 10000);
    }
  };

  const handleStopInstance = async (instanceId: string) => {
    try {
      await api.stopInstance(instanceId);
      await loadData();
      setInstanceError(null);
    } catch (err) {
      setInstanceError(
        err instanceof Error ? err.message : "Failed to stop instance",
      );
      setTimeout(() => setInstanceError(null), 10000);
    }
  };

  const handleStartInstance = async (worktreeId: string) => {
    try {
      await api.startInstance(worktreeId);
      await loadData();
      setInstanceError(null);
    } catch (err) {
      setInstanceError(
        err instanceof Error ? err.message : "Failed to start instance",
      );
      setTimeout(() => setInstanceError(null), 10000);
    }
  };

  const toggleLeftPanel = () => {
    setIsLeftPanelCollapsed((prev) => !prev);
  };

  const selectedWorktree: Worktree | null =
    repositories
      .flatMap((repo) => repo.worktrees)
      .find((worktree) => worktree.id === selectedWorktreeId) ?? null;

  const selectedInstance: ClaudeInstance | null = selectedWorktree
    ? (instances.find(
        (instance) => instance.worktreeId === selectedWorktree.id,
      ) ?? null)
    : null;

  const selectedRepository: Repository | null =
    repositories.find((repo) => repo.id === selectedRepositoryId) ?? null;

  if (loading) {
    return (
      <div className="container">
        <div className="loading">Loading...</div>
      </div>
    );
  }

  return (
    <div className="container">
      <div className="header">
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "20px" }}>
            <h1
              onClick={() => {
                setSelectedWorktreeId(null);
                setSelectedRepositoryId(null);
                router.push("/");
              }}
              style={{
                cursor: "pointer",
                transition: "color 0.2s ease",
                margin: 20,
              }}
              onMouseEnter={(e) =>
                ((e.target as HTMLElement).style.color = "#58a6ff")
              }
              onMouseLeave={(e) => ((e.target as HTMLElement).style.color = "")}
            >
              {appName}
            </h1>
            {isDatabaseUnlocked && (
              <nav style={{ display: "flex", gap: "16px" }}>
                <button
                  onClick={() => router.push("/database")}
                  className="nav-button"
                >
                  Database
                </button>
              </nav>
            )}
          </div>
          <div
            style={{ display: "flex", gap: "12px", alignItems: "center" }}
          ></div>
        </div>
      </div>

      <SystemStatusPanel />

      <div className="main-layout">
        <RepositoryPanel
          repositories={repositories}
          instances={instances}
          selectedWorktreeId={selectedWorktreeId}
          selectedRepositoryId={selectedRepositoryId}
          onSelectWorktree={handleSelectWorktree}
          onSelectRepository={handleSelectRepository}
          onCreateWorktreeAndStartInstance={
            handleCreateWorktreeAndStartInstance
          }
          onDeleteWorktree={handleDeleteWorktree}
          onRefreshMainBranch={handleRefreshMainBranch}
          isCollapsed={isLeftPanelCollapsed}
          onToggleCollapse={toggleLeftPanel}
          onRefreshData={loadData}
        />

        {selectedRepository ? (
          <RepositoryDashboardPanel
            repository={selectedRepository}
            isLeftPanelCollapsed={isLeftPanelCollapsed}
            onSelectWorktree={handleSelectWorktree}
          />
        ) : (
          <AgentPanel
            selectedWorktree={selectedWorktree}
            selectedInstance={selectedInstance}
            onRestartInstance={handleRestartInstance}
            onStopInstance={handleStopInstance}
            onStartInstance={handleStartInstance}
            onDeleteWorktree={handleDeleteWorktree}
            error={instanceError}
            isLeftPanelCollapsed={isLeftPanelCollapsed}
          />
        )}
      </div>

      {error && <div className="error-toast">{error}</div>}
    </div>
  );
}

function DashboardLoading() {
  return (
    <div className="container">
      <div className="loading">Loading...</div>
    </div>
  );
}

export default function DashboardPage() {
  return (
    <Suspense fallback={<DashboardLoading />}>
      <DashboardContent />
    </Suspense>
  );
}
