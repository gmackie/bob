"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import type { ClaudeInstance } from "~/lib/legacy/types";
import { useCheatCode } from "~/contexts";
import { getAppConfig } from "~/lib/legacy/config";
import { api } from "~/lib/rest/api";
import { UsageGraphs } from "./_components/usage-graphs";

type DashboardV2 = {
  workspace: { id: string; name: string; slug: string };
  generatedAt: string;
  totals: { inProgress: number; inReview: number; doneLast24h: number };
  projects: Array<{
    project: { id: string; key: string; name: string; color?: string };
    counts: { inProgress: number; inReview: number; done24h: number };
    repository: {
      id: string;
      name: string;
      path: string;
      remoteProvider: string | null;
      remoteUrl: string | null;
    } | null;
    mappingError: string | null;
  }>;
  activeRuns: Array<{
    id: string;
    kanbangerIssueId: string;
    kanbangerIssueIdentifier: string;
    status: string;
    blockedReason: string | null;
    updatedAt: string | null;
    repository: {
      id: string;
      name: string;
      path: string;
      kanbangerProjectId: string | null;
    } | null;
  }>;
};

type AgentType =
  | "claude"
  | "kiro"
  | "codex"
  | "gemini"
  | "opencode"
  | "cursor-agent";

type RepoOptionsResponse = {
  connections: Array<{
    provider: "gitea" | "github";
    instanceUrl: string | null;
  }>;
  repos: Array<{
    fullName: string;
    preferred: {
      provider: "gitea" | "github";
      instanceUrl: string | null;
      sshUrl: string;
      htmlUrl: string;
      defaultBranch: string;
      isPrivate: boolean;
    };
    sources: {
      gitea: null | {
        instanceUrl: string | null;
        sshUrl: string;
        htmlUrl: string;
        defaultBranch: string;
        isPrivate: boolean;
      };
      github: null | {
        instanceUrl: string | null;
        sshUrl: string;
        htmlUrl: string;
        defaultBranch: string;
        isPrivate: boolean;
      };
    };
  }>;
};

function toCount(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function fmtCount(value: unknown): string {
  const n = toCount(value);
  if (n === null) return "-";
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(
    n,
  );
}

function mappingLabel(error: string | null): string {
  if (!error) return "mapped";
  if (error === "unmapped") return "unmapped";
  if (error === "multiple_repos_mapped") return "ambiguous";
  return "mismatch";
}

function DashboardContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const { isDatabaseUnlocked } = useCheatCode();

  const [instances, setInstances] = useState<ClaudeInstance[]>([]);
  const [dash, setDash] = useState<DashboardV2 | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(
    null,
  );
  const [appName, setAppName] = useState("Bob");

  const [repoPickerOpen, setRepoPickerOpen] = useState(false);
  const [repoOptions, setRepoOptions] = useState<RepoOptionsResponse | null>(
    null,
  );
  const [repoOptionsLoading, setRepoOptionsLoading] = useState(false);
  const [repoOptionsError, setRepoOptionsError] = useState<string | null>(null);
  const [repoSearch, setRepoSearch] = useState("");
  const [pendingRepoFullName, setPendingRepoFullName] = useState<string | null>(
    null,
  );
  const [pendingRepoProvider, setPendingRepoProvider] = useState<
    "gitea" | "github"
  >("gitea");
  const [mappingBusy, setMappingBusy] = useState(false);
  const [mappingMessage, setMappingMessage] = useState<string | null>(null);

  const [startSessionOpen, setStartSessionOpen] = useState(false);
  const [newBranchName, setNewBranchName] = useState("");
  const [baseBranch, setBaseBranch] = useState("");
  const [taskIdentifier, setTaskIdentifier] = useState("");
  const [agentType, setAgentType] = useState<AgentType>("claude");
  const [startBusy, setStartBusy] = useState(false);
  const [lastCreated, setLastCreated] = useState<null | {
    worktreeId: string;
    worktreePath: string;
    instanceId: string;
    instanceStatus: string;
    taskRunId: string | null;
    taskIdentifier: string | null;
  }>(null);

  const updateUrlWithSelection = useCallback(
    (key: string, value: string | null) => {
      const params = new URLSearchParams(searchParams.toString());
      if (value) params.set(key, value);
      else params.delete(key);
      const qs = params.toString();
      router.push(qs ? `${pathname}?${qs}` : pathname);
    },
    [pathname, router, searchParams],
  );

  const loadInstances = useCallback(async () => {
    const instancesData = await api.getInstances();
    setInstances(instancesData);
  }, []);

  const loadDashboard = useCallback(async () => {
    const res = await fetch("/api/kanbanger/dashboard-v2", {
      method: "GET",
      headers: { Accept: "application/json" },
      credentials: "include",
      cache: "no-store",
    });

    if (!res.ok) {
      setDash(null);
      return;
    }

    const data = (await res.json()) as DashboardV2;
    setDash(data);
  }, []);

  const loadRepoOptions = useCallback(async () => {
    setRepoOptionsLoading(true);
    setRepoOptionsError(null);
    try {
      const res = await fetch("/api/kanbanger/repo-options", {
        method: "GET",
        headers: { Accept: "application/json" },
        credentials: "include",
        cache: "no-store",
      });
      if (!res.ok) {
        throw new Error(`Failed to load repo options (HTTP ${res.status})`);
      }
      const data = (await res.json()) as RepoOptionsResponse;
      setRepoOptions(data);
    } catch (e) {
      setRepoOptions(null);
      setRepoOptionsError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setRepoOptionsLoading(false);
    }
  }, []);

  useEffect(() => {
    const projectParam = searchParams.get("project");
    if (projectParam && projectParam !== selectedProjectId) {
      setSelectedProjectId(projectParam);
    }
    if (!projectParam && selectedProjectId) {
      setSelectedProjectId(null);
    }
  }, [searchParams, selectedProjectId]);

  useEffect(() => {
    getAppConfig().then((config) => setAppName(config.appName));
  }, []);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        await loadDashboard();
        if (!cancelled) {
          setError(null);
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Failed to load");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    })();

    void loadInstances().catch((e) => {
      if (cancelled) return;
      const message = e instanceof Error ? e.message : "Failed to load agents";
      setError((prev) => prev ?? message);
    });

    return () => {
      cancelled = true;
    };
  }, [loadDashboard, loadInstances]);

  useEffect(() => {
    if (!repoPickerOpen) return;
    void loadRepoOptions();
  }, [loadRepoOptions, repoPickerOpen]);

  useEffect(() => {
    setMappingMessage(null);
    setPendingRepoFullName(null);
    setRepoSearch("");
    setTaskIdentifier("");
  }, [selectedProjectId]);

  useEffect(() => {
    const key = "bob:kanbangerPreseed:lastRunAt";
    const throttleMs = 6 * 60 * 60 * 1000;

    try {
      const last = localStorage.getItem(key);
      if (last) {
        const lastMs = Number(last);
        if (!Number.isNaN(lastMs) && Date.now() - lastMs < throttleMs) return;
      }
    } catch {
      // ignore
    }

    let cancelled = false;

    void (async () => {
      try {
        const res = await fetch("/api/kanbanger/sync-repos", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
        });

        if (!res.ok) return;
        const data = (await res.json().catch(() => null)) as null | {
          projects?: number;
          cloned?: number;
          skipped?: number;
          unmatched?: number;
          errors?: number;
        };

        if (cancelled) return;

        // Only throttle if we actually mapped something or had errors.
        const projects = data?.projects ?? 0;
        const unmatched = data?.unmatched ?? 0;
        const hadAnyMatch = projects > 0 && unmatched < projects;
        const hadAnyWork =
          (data?.cloned ?? 0) > 0 ||
          (data?.skipped ?? 0) > 0 ||
          (data?.errors ?? 0) > 0 ||
          hadAnyMatch;

        if (hadAnyWork) {
          try {
            localStorage.setItem(key, String(Date.now()));
          } catch {
            // ignore
          }
        }

        await loadDashboard();
      } catch {
        // ignore
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [loadDashboard]);

  const agentStats = useMemo(() => {
    return {
      running: instances.filter((i) => i.status === "running").length,
      starting: instances.filter((i) => i.status === "starting").length,
      error: instances.filter((i) => i.status === "error").length,
    };
  }, [instances]);

  const projects = dash?.projects ?? [];

  const selectedProject = useMemo(() => {
    if (!selectedProjectId) return null;
    return projects.find((p) => p.project.id === selectedProjectId) ?? null;
  }, [projects, selectedProjectId]);

  const repoCandidates = useMemo(() => {
    const list = repoOptions?.repos ?? [];
    const q = repoSearch.trim().toLowerCase();
    if (!q) return list;
    return list
      .filter((r) => r.fullName.toLowerCase().includes(q))
      .slice(0, 200);
  }, [repoOptions?.repos, repoSearch]);

  const selectedRepoOption = useMemo(() => {
    if (!pendingRepoFullName) return null;
    return (
      repoOptions?.repos.find((r) => r.fullName === pendingRepoFullName) ?? null
    );
  }, [pendingRepoFullName, repoOptions?.repos]);

  const availableProvidersForPending = useMemo(() => {
    if (!selectedRepoOption) return [] as Array<"gitea" | "github">;
    const out: Array<"gitea" | "github"> = [];
    if (selectedRepoOption.sources.gitea) out.push("gitea");
    if (selectedRepoOption.sources.github) out.push("github");
    return out;
  }, [selectedRepoOption]);

  const mapSelectedRepo = useCallback(async () => {
    if (!selectedProjectId) return;
    if (!selectedRepoOption) return;
    if (!availableProvidersForPending.includes(pendingRepoProvider)) return;

    setMappingBusy(true);
    setMappingMessage(null);
    try {
      const res = await fetch(
        `/api/kanbanger/projects/${selectedProjectId}/repo`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            provider: pendingRepoProvider,
            fullName: selectedRepoOption.fullName,
            instanceUrl:
              pendingRepoProvider === "gitea"
                ? (selectedRepoOption.sources.gitea?.instanceUrl ??
                  selectedRepoOption.preferred.instanceUrl)
                : (selectedRepoOption.sources.github?.instanceUrl ??
                  selectedRepoOption.preferred.instanceUrl),
            clone: true,
          }),
        },
      );
      const payload = (await res.json().catch(() => null)) as any;
      if (!res.ok) {
        throw new Error(
          payload?.error || `Failed to map repo (HTTP ${res.status})`,
        );
      }

      setRepoPickerOpen(false);
      setPendingRepoFullName(null);
      setMappingMessage("Mapped successfully.");
      await loadDashboard();
    } catch (e) {
      setMappingMessage(e instanceof Error ? e.message : "Failed to map");
    } finally {
      setMappingBusy(false);
    }
  }, [
    availableProvidersForPending,
    loadDashboard,
    pendingRepoProvider,
    selectedProjectId,
    selectedRepoOption,
  ]);

  const unmapProject = useCallback(async () => {
    if (!selectedProjectId) return;
    setMappingBusy(true);
    setMappingMessage(null);
    try {
      const res = await fetch(
        `/api/kanbanger/projects/${selectedProjectId}/repo`,
        {
          method: "DELETE",
          credentials: "include",
        },
      );
      const payload = (await res.json().catch(() => null)) as any;
      if (!res.ok) {
        throw new Error(
          payload?.error || `Failed to unmap (HTTP ${res.status})`,
        );
      }
      setMappingMessage("Unmapped.");
      await loadDashboard();
    } catch (e) {
      setMappingMessage(e instanceof Error ? e.message : "Failed to unmap");
    } finally {
      setMappingBusy(false);
    }
  }, [loadDashboard, selectedProjectId]);

  const startSession = useCallback(async () => {
    if (!selectedProjectId) return;
    const bn = newBranchName.trim();
    const taskId = taskIdentifier.trim().toUpperCase();
    const workspaceId = dash?.workspace.id ?? "";
    if (!bn) {
      setMappingMessage("Branch name is required.");
      return;
    }
    if (taskId && !workspaceId) {
      setMappingMessage("Workspace context is missing. Reload and try again.");
      return;
    }
    setStartBusy(true);
    setMappingMessage(null);
    try {
      const res = await fetch(
        `/api/kanbanger/projects/${selectedProjectId}/start-session`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
              branchName: bn,
              baseBranch: baseBranch.trim() || undefined,
              agentType,
              taskIdentifier: taskId || undefined,
              workspaceId: taskId ? workspaceId : undefined,
            }),
          },
      );
      const payload = (await res.json().catch(() => null)) as any;
      if (!res.ok) {
        throw new Error(
          payload?.error || `Failed to start session (HTTP ${res.status})`,
        );
      }

      setLastCreated({
        worktreeId: String(payload?.worktree?.id ?? ""),
        worktreePath: String(payload?.worktree?.path ?? ""),
        instanceId: String(payload?.instance?.id ?? ""),
        instanceStatus: String(payload?.instance?.status ?? ""),
        taskRunId:
          typeof payload?.taskRun?.id === "string" ? payload.taskRun.id : null,
        taskIdentifier:
          typeof payload?.taskRun?.kanbangerIssueIdentifier === "string"
            ? payload.taskRun.kanbangerIssueIdentifier
            : taskId || null,
      });

      setStartSessionOpen(false);
      setNewBranchName("");
      setBaseBranch("");
      setTaskIdentifier("");

      await Promise.all([loadInstances(), loadDashboard()]);
      if (taskId) {
        const createdTaskIdentifier =
          (typeof payload?.taskRun?.kanbangerIssueIdentifier === "string"
            ? payload.taskRun.kanbangerIssueIdentifier
            : taskId) || taskId;
        setMappingMessage(`Session started for ${createdTaskIdentifier}.`);
      } else {
        setMappingMessage("Session started.");
      }
    } catch (e) {
      setMappingMessage(e instanceof Error ? e.message : "Failed to start");
    } finally {
      setStartBusy(false);
    }
  }, [
    agentType,
    baseBranch,
    dash?.workspace.id,
    loadDashboard,
    loadInstances,
    newBranchName,
    selectedProjectId,
    taskIdentifier,
  ]);

  const mappingErrors = useMemo(() => {
    return projects
      .filter((p) => p.mappingError)
      .map((p) => ({
        key: p.project.key,
        name: p.project.name,
        error: p.mappingError as string,
      }));
  }, [projects]);

  const activeRunsForSelectedProject = useMemo(() => {
    if (!selectedProjectId) return [];
    return (dash?.activeRuns ?? []).filter(
      (r) => r.repository?.kanbangerProjectId === selectedProjectId,
    );
  }, [dash?.activeRuns, selectedProjectId]);

  if (loading) {
    return (
      <div className="container">
        <div className="loading">Loading...</div>
      </div>
    );
  }

  return (
    <div className="dash-shell container">
      <header className="dash-top">
        <div className="dash-topbar">
          <div className="dash-brand">
            <button
              type="button"
              className="dash-brandButton"
              onClick={() => {
                setSelectedProjectId(null);
                updateUrlWithSelection("project", null);
              }}
              aria-label="Back to overview"
            >
              <span className="dash-brandMark" aria-hidden>
                {appName.slice(0, 1).toUpperCase()}
              </span>
              <span className="dash-brandName">{appName}</span>
            </button>

            {isDatabaseUnlocked && (
              <nav className="dash-nav">
                <button
                  onClick={() => router.push("/database")}
                  className="nav-button"
                >
                  Database
                </button>
              </nav>
            )}
          </div>

          <div className="dash-meta">
            <div className="dash-agentMeta" title="Agent instances">
              <span className="dash-metaLabel">Agents</span>
              <span className="dash-metaValue">
                {fmtCount(agentStats.running)} running
              </span>
              <span className="dash-metaDim">
                {fmtCount(agentStats.starting)} starting
              </span>
              {agentStats.error ? (
                <span className="dash-metaWarn">
                  {fmtCount(agentStats.error)} error
                </span>
              ) : null}
            </div>
          </div>
        </div>

        <div className="dash-overview">
          <div className="dash-statGrid">
            <div className="dash-statCard">
              <div className="dash-statLabel">Tasks in progress</div>
              <div className="dash-statValue">
                {dash ? fmtCount(dash.totals.inProgress) : "-"}
              </div>
              <div className="dash-statHint">
                {dash ? dash.workspace.name : "Kanbanger unavailable"}
              </div>
            </div>

            <div className="dash-statCard">
              <div className="dash-statLabel">In review / testing</div>
              <div className="dash-statValue">
                {dash ? fmtCount(dash.totals.inReview) : "-"}
              </div>
              <div className="dash-statHint">Status: in_review</div>
            </div>

            <div className="dash-statCard">
              <div className="dash-statLabel">Done (last 24h)</div>
              <div className="dash-statValue">
                {dash ? fmtCount(dash.totals.doneLast24h) : "-"}
              </div>
              <div className="dash-statHint">By completedAt / updatedAt</div>
            </div>
          </div>
        </div>

        <UsageGraphs />
      </header>

      <div className="main-layout">
        <aside className="left-panel">
          <div className="panel-header" style={{ padding: "14px 16px" }}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: "12px",
              }}
            >
              <div>
                <div
                  style={{
                    fontSize: "12px",
                    color: "rgba(232, 238, 248, 0.6)",
                    letterSpacing: "0.08em",
                    textTransform: "uppercase",
                  }}
                >
                  Projects
                </div>
                <div
                  style={{
                    fontSize: "14px",
                    fontWeight: 650,
                    color: "#e8eef8",
                  }}
                >
                  {dash ? fmtCount(projects.length) : "-"}
                </div>
              </div>
              {mappingErrors.length ? (
                <div
                  title="Mapping mismatches"
                  style={{
                    fontSize: "12px",
                    color: "rgba(255, 186, 110, 0.95)",
                  }}
                >
                  {fmtCount(mappingErrors.length)} errors
                </div>
              ) : null}
            </div>
          </div>

          <div
            className="worktrees-list"
            style={{ padding: "10px", overflowY: "auto" }}
          >
            {!dash ? (
              <div
                style={{
                  padding: "14px",
                  color: "rgba(232, 238, 248, 0.55)",
                  fontSize: "13px",
                }}
              >
                Kanbanger unavailable
              </div>
            ) : (
              <div style={{ display: "grid", gap: "10px" }}>
                <button
                  type="button"
                  onClick={() => {
                    setSelectedProjectId(null);
                    updateUrlWithSelection("project", null);
                  }}
                  style={{
                    textAlign: "left",
                    padding: "10px 12px",
                    borderRadius: "14px",
                    border: "1px solid rgba(255,255,255,0.10)",
                    background: !selectedProjectId
                      ? "rgba(255,255,255,0.06)"
                      : "rgba(255,255,255,0.03)",
                    color: "#e8eef8",
                    cursor: "pointer",
                  }}
                >
                  <div
                    style={{
                      fontSize: "12px",
                      letterSpacing: "0.08em",
                      textTransform: "uppercase",
                      color: "rgba(232,238,248,0.6)",
                    }}
                  >
                    All Projects
                  </div>
                  <div
                    style={{
                      fontSize: "13px",
                      color: "rgba(232,238,248,0.75)",
                    }}
                  >
                    Global overview
                  </div>
                </button>

                {projects
                  .slice()
                  .sort((a, b) => a.project.key.localeCompare(b.project.key))
                  .map((p) => {
                    const isActive = p.project.id === selectedProjectId;
                    const isError = Boolean(p.mappingError);
                    return (
                      <button
                        key={p.project.id}
                        type="button"
                        onClick={() => {
                          setSelectedProjectId(p.project.id);
                          updateUrlWithSelection("project", p.project.id);
                        }}
                        style={{
                          textAlign: "left",
                          padding: "10px 12px",
                          borderRadius: "14px",
                          border: isActive
                            ? "1px solid rgba(100,160,255,0.35)"
                            : "1px solid rgba(255,255,255,0.10)",
                          background: isActive
                            ? "rgba(100,160,255,0.09)"
                            : "rgba(255,255,255,0.03)",
                          color: "#e8eef8",
                          cursor: "pointer",
                        }}
                      >
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                            gap: "10px",
                          }}
                        >
                          <div
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: "10px",
                              minWidth: 0,
                            }}
                          >
                            <span
                              aria-hidden
                              style={{
                                width: "10px",
                                height: "10px",
                                borderRadius: 999,
                                background:
                                  p.project.color ?? "rgba(255,255,255,0.25)",
                                boxShadow: "0 0 0 3px rgba(255,255,255,0.06)",
                                flex: "0 0 auto",
                              }}
                            />
                            <div style={{ minWidth: 0 }}>
                              <div
                                style={{
                                  display: "flex",
                                  alignItems: "baseline",
                                  gap: "8px",
                                }}
                              >
                                <span
                                  style={{
                                    fontWeight: 800,
                                    letterSpacing: "0.06em",
                                    fontSize: "12px",
                                  }}
                                >
                                  {p.project.key}
                                </span>
                                <span
                                  style={{
                                    fontSize: "12px",
                                    color: "rgba(232,238,248,0.65)",
                                    overflow: "hidden",
                                    textOverflow: "ellipsis",
                                    whiteSpace: "nowrap",
                                  }}
                                >
                                  {p.project.name}
                                </span>
                              </div>
                              <div
                                style={{
                                  fontSize: "12px",
                                  color: "rgba(232,238,248,0.6)",
                                  marginTop: "4px",
                                }}
                              >
                                {fmtCount(p.counts.inProgress)} ip {" "}
                                {fmtCount(p.counts.inReview)} rev {" "}
                                {fmtCount(p.counts.done24h)} 24h
                              </div>
                            </div>
                          </div>

                          <div
                            style={{
                              fontSize: "10px",
                              letterSpacing: "0.08em",
                              textTransform: "uppercase",
                              color: isError
                                ? "rgba(255, 186, 110, 0.95)"
                                : "rgba(59, 211, 127, 0.95)",
                            }}
                            title={p.mappingError ?? "mapped"}
                          >
                            {mappingLabel(p.mappingError)}
                          </div>
                        </div>
                      </button>
                    );
                  })}
              </div>
            )}
          </div>
        </aside>

        <main className="right-panel">
          <div className="panel-header" style={{ padding: "14px 16px" }}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: "12px",
              }}
            >
              <div>
                <div
                  style={{
                    fontSize: "12px",
                    color: "rgba(232, 238, 248, 0.6)",
                    letterSpacing: "0.08em",
                    textTransform: "uppercase",
                  }}
                >
                  Dashboard
                </div>
                <div
                  style={{
                    fontSize: "14px",
                    fontWeight: 650,
                    color: "#e8eef8",
                  }}
                >
                  {selectedProject
                    ? `${selectedProject.project.key}  ${selectedProject.project.name}`
                    : "All projects"}
                </div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                {selectedProject?.repository ? (
                  <button
                    type="button"
                    className="nav-button"
                    onClick={() => setStartSessionOpen(true)}
                    disabled={startBusy || mappingBusy}
                  >
                    New task / agent
                  </button>
                ) : null}
                {selectedProject?.mappingError ? (
                  <div
                    style={{
                      fontSize: "12px",
                      color: "rgba(255, 186, 110, 0.95)",
                    }}
                  >
                    Mapping mismatch: {selectedProject.mappingError}
                  </div>
                ) : null}
              </div>
            </div>
          </div>

          <div className="panel-content" style={{ padding: "16px" }}>
            {!dash ? (
              <div className="loading">Loading dashboard...</div>
            ) : selectedProject ? (
              <div style={{ display: "grid", gap: "14px" }}>
                <div className="dash-projectRow">
                  <div className="dash-projectRowHeader">
                    <div className="dash-projectRowTitle">Repository</div>
                    <div className="dash-projectRowMeta">
                      {selectedProject.repository ? "mapped" : "unmapped"}
                    </div>
                  </div>
                  <div style={{ padding: "12px 14px 14px 14px" }}>
                    {selectedProject.repository ? (
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          gap: "12px",
                          alignItems: "flex-start",
                        }}
                      >
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontWeight: 800, fontSize: "13px" }}>
                            {selectedProject.repository.name}
                          </div>
                          <div
                            style={{
                              marginTop: "4px",
                              fontSize: "12px",
                              color: "rgba(232,238,248,0.65)",
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                            }}
                            title={selectedProject.repository.path}
                          >
                            {selectedProject.repository.path}
                          </div>
                          {selectedProject.repository.remoteUrl ? (
                            <div
                              style={{
                                marginTop: "6px",
                                fontSize: "12px",
                                color: "rgba(232,238,248,0.55)",
                              }}
                            >
                              {selectedProject.repository.remoteProvider
                                ? `${selectedProject.repository.remoteProvider}: `
                                : ""}
                              {selectedProject.repository.remoteUrl}
                            </div>
                          ) : null}
                        </div>

                        <div
                          style={{
                            display: "flex",
                            gap: "8px",
                            flex: "0 0 auto",
                          }}
                        >
                          <button
                            type="button"
                            className="nav-button"
                            onClick={() => setRepoPickerOpen(true)}
                            disabled={mappingBusy}
                          >
                            Change mapping
                          </button>
                          <button
                            type="button"
                            className="nav-button"
                            onClick={() => {
                              if (
                                confirm(
                                  "Unmap this project from its repository?",
                                )
                              ) {
                                void unmapProject();
                              }
                            }}
                            disabled={mappingBusy}
                          >
                            Unmap
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          gap: "12px",
                        }}
                      >
                        <div
                          style={{
                            color: "rgba(232,238,248,0.65)",
                            fontSize: "13px",
                          }}
                        >
                          No repository mapped yet.
                        </div>
                        <button
                          type="button"
                          className="nav-button"
                          onClick={() => setRepoPickerOpen(true)}
                          disabled={mappingBusy}
                        >
                          Map repo
                        </button>
                      </div>
                    )}

                    {mappingMessage ? (
                      <div
                        style={{
                          marginTop: "10px",
                          fontSize: "12px",
                          color: "rgba(232,238,248,0.7)",
                        }}
                      >
                        {mappingMessage}
                      </div>
                    ) : null}
                  </div>
                </div>

                <div className="dash-projectRow">
                  <div className="dash-projectRowHeader">
                    <div className="dash-projectRowTitle">Worktree / agent</div>
                    <div className="dash-projectRowMeta">create</div>
                  </div>
                  <div style={{ padding: "12px 14px 14px 14px" }}>
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        gap: "12px",
                      }}
                    >
                      <div
                        style={{
                          color: "rgba(232,238,248,0.65)",
                          fontSize: "13px",
                        }}
                      >
                        Create a task run, branch worktree, and agent instance.
                      </div>
                      <button
                        type="button"
                        className="nav-button"
                        onClick={() => setStartSessionOpen(true)}
                        disabled={
                          startBusy ||
                          mappingBusy ||
                          !selectedProject.repository
                        }
                        title={
                          selectedProject.repository
                            ? "Create worktree"
                            : "Map a repository first"
                        }
                      >
                        New task / agent
                      </button>
                    </div>

                    {lastCreated?.instanceId ? (
                      <div
                        style={{
                          marginTop: "10px",
                          border: "1px solid rgba(255,255,255,0.10)",
                          borderRadius: "14px",
                          background: "rgba(9, 12, 18, 0.55)",
                          padding: "10px 12px",
                          display: "grid",
                          gap: "6px",
                        }}
                      >
                        <div style={{ fontWeight: 800, fontSize: "12px" }}>
                          Started
                        </div>
                        <div
                          style={{
                            fontSize: "12px",
                            color: "rgba(232,238,248,0.7)",
                          }}
                        >
                          Instance: {lastCreated.instanceId} (
                          {lastCreated.instanceStatus})
                        </div>
                        {lastCreated.taskIdentifier ? (
                          <div
                            style={{
                              fontSize: "12px",
                              color: "rgba(232,238,248,0.7)",
                            }}
                          >
                            Task: {lastCreated.taskIdentifier}
                          </div>
                        ) : null}
                        <div
                          style={{
                            fontSize: "12px",
                            color: "rgba(232,238,248,0.55)",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                          title={lastCreated.worktreePath}
                        >
                          Worktree: {lastCreated.worktreePath}
                        </div>
                      </div>
                    ) : null}
                  </div>
                </div>

                <div
                  className="dash-statGrid"
                  style={{ gridTemplateColumns: "repeat(3, minmax(0, 1fr))" }}
                >
                  <div className="dash-statCard">
                    <div className="dash-statLabel">In progress</div>
                    <div className="dash-statValue">
                      {fmtCount(selectedProject.counts.inProgress)}
                    </div>
                    <div className="dash-statHint">Project</div>
                  </div>
                  <div className="dash-statCard">
                    <div className="dash-statLabel">In review</div>
                    <div className="dash-statValue">
                      {fmtCount(selectedProject.counts.inReview)}
                    </div>
                    <div className="dash-statHint">Project</div>
                  </div>
                  <div className="dash-statCard">
                    <div className="dash-statLabel">Done (24h)</div>
                    <div className="dash-statValue">
                      {fmtCount(selectedProject.counts.done24h)}
                    </div>
                    <div className="dash-statHint">Project</div>
                  </div>
                </div>

                <div className="dash-projectRow">
                  <div className="dash-projectRowHeader">
                    <div className="dash-projectRowTitle">Active work</div>
                    <div className="dash-projectRowMeta">
                      {fmtCount(activeRunsForSelectedProject.length)}
                    </div>
                  </div>
                  <div style={{ padding: "10px 14px 14px 14px" }}>
                    {activeRunsForSelectedProject.length === 0 ? (
                      <div
                        style={{
                          color: "rgba(232,238,248,0.55)",
                          fontSize: "13px",
                        }}
                      >
                        No active task runs for this project.
                      </div>
                    ) : (
                      <div style={{ display: "grid", gap: "10px" }}>
                        {activeRunsForSelectedProject.slice(0, 50).map((r) => (
                          <div
                            key={r.id}
                            style={{
                              border: "1px solid rgba(255,255,255,0.10)",
                              borderRadius: "14px",
                              background: "rgba(9, 12, 18, 0.55)",
                              padding: "10px 12px",
                              display: "flex",
                              justifyContent: "space-between",
                              gap: "10px",
                            }}
                          >
                            <div>
                              <div
                                style={{ fontWeight: 700, fontSize: "13px" }}
                              >
                                {r.kanbangerIssueIdentifier}
                              </div>
                              {r.blockedReason ? (
                                <div
                                  style={{
                                    fontSize: "12px",
                                    color: "rgba(255, 186, 110, 0.95)",
                                    marginTop: "2px",
                                  }}
                                >
                                  {r.blockedReason}
                                </div>
                              ) : null}
                            </div>
                            <div
                              style={{
                                fontSize: "12px",
                                color: "rgba(232,238,248,0.65)",
                              }}
                            >
                              {r.status}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ) : (
              <div style={{ display: "grid", gap: "14px" }}>
                {mappingErrors.length ? (
                  <div
                    style={{
                      border: "1px solid rgba(255, 186, 110, 0.35)",
                      background: "rgba(255, 186, 110, 0.08)",
                      borderRadius: "16px",
                      padding: "12px 14px",
                      color: "rgba(232,238,248,0.9)",
                    }}
                  >
                    <div style={{ fontWeight: 750, fontSize: "13px" }}>
                      Project mapping mismatches
                    </div>
                    <div
                      style={{
                        marginTop: "8px",
                        display: "grid",
                        gap: "6px",
                        fontSize: "12px",
                        color: "rgba(232,238,248,0.75)",
                      }}
                    >
                      {mappingErrors.slice(0, 6).map((e) => (
                        <div key={e.key}>
                          <strong style={{ color: "rgba(232,238,248,0.95)" }}>
                            {e.key}
                          </strong>{" "}
                           {e.name} {" "}
                          <span style={{ color: "rgba(255, 186, 110, 0.95)" }}>
                            {e.error}
                          </span>
                        </div>
                      ))}
                      {mappingErrors.length > 6 ? (
                        <div style={{ color: "rgba(232,238,248,0.6)" }}>
                          +{fmtCount(mappingErrors.length - 6)} more
                        </div>
                      ) : null}
                    </div>
                  </div>
                ) : null}

                <div className="dash-projectRow">
                  <div className="dash-projectRowHeader">
                    <div className="dash-projectRowTitle">Active work</div>
                    <div className="dash-projectRowMeta">
                      {fmtCount(dash.activeRuns.length)}
                    </div>
                  </div>
                  <div style={{ padding: "10px 14px 14px 14px" }}>
                    {dash.activeRuns.length === 0 ? (
                      <div
                        style={{
                          color: "rgba(232,238,248,0.55)",
                          fontSize: "13px",
                        }}
                      >
                        No active task runs.
                      </div>
                    ) : (
                      <div style={{ display: "grid", gap: "10px" }}>
                        {dash.activeRuns.slice(0, 80).map((r) => {
                          const project = projects.find(
                            (p) =>
                              p.project.id === r.repository?.kanbangerProjectId,
                          );
                          return (
                            <div
                              key={r.id}
                              style={{
                                border: "1px solid rgba(255,255,255,0.10)",
                                borderRadius: "14px",
                                background: "rgba(9, 12, 18, 0.55)",
                                padding: "10px 12px",
                                display: "grid",
                                gridTemplateColumns: "160px 1fr 120px",
                                gap: "10px",
                                alignItems: "center",
                              }}
                            >
                              <div
                                style={{
                                  display: "flex",
                                  alignItems: "center",
                                  gap: "10px",
                                  minWidth: 0,
                                }}
                              >
                                <span
                                  aria-hidden
                                  style={{
                                    width: "10px",
                                    height: "10px",
                                    borderRadius: 999,
                                    background:
                                      project?.project.color ??
                                      "rgba(255,255,255,0.25)",
                                    boxShadow:
                                      "0 0 0 3px rgba(255,255,255,0.06)",
                                    flex: "0 0 auto",
                                  }}
                                />
                                <div style={{ minWidth: 0 }}>
                                  <div
                                    style={{
                                      fontWeight: 800,
                                      fontSize: "12px",
                                      letterSpacing: "0.06em",
                                    }}
                                  >
                                    {project?.project.key ?? "UNMAPPED"}
                                  </div>
                                  <div
                                    style={{
                                      fontSize: "12px",
                                      color: "rgba(232,238,248,0.6)",
                                      overflow: "hidden",
                                      textOverflow: "ellipsis",
                                      whiteSpace: "nowrap",
                                    }}
                                  >
                                    {project?.project.name ??
                                      "No project mapping"}
                                  </div>
                                </div>
                              </div>

                              <div>
                                <div
                                  style={{ fontWeight: 750, fontSize: "13px" }}
                                >
                                  {r.kanbangerIssueIdentifier}
                                </div>
                                {r.blockedReason ? (
                                  <div
                                    style={{
                                      fontSize: "12px",
                                      color: "rgba(255, 186, 110, 0.95)",
                                      marginTop: "2px",
                                    }}
                                  >
                                    {r.blockedReason}
                                  </div>
                                ) : null}
                              </div>

                              <div
                                style={{
                                  textAlign: "right",
                                  fontSize: "12px",
                                  color: "rgba(232,238,248,0.7)",
                                }}
                              >
                                {r.status}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        </main>
      </div>

      {error && <div className="error-toast">{error}</div>}

      {repoPickerOpen ? (
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(5, 7, 11, 0.72)",
            display: "grid",
            placeItems: "center",
            padding: "20px",
            zIndex: 50,
          }}
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setRepoPickerOpen(false);
          }}
        >
          <div
            style={{
              width: "min(860px, 100%)",
              maxHeight: "min(740px, 100%)",
              overflow: "hidden",
              borderRadius: "18px",
              border: "1px solid rgba(255,255,255,0.14)",
              background:
                "linear-gradient(180deg, rgba(12, 16, 24, 0.96), rgba(8, 10, 16, 0.94))",
              boxShadow:
                "0 24px 80px rgba(0,0,0,0.55), inset 0 1px 0 rgba(255,255,255,0.06)",
              display: "grid",
              gridTemplateRows: "auto auto 1fr auto",
            }}
          >
            <div
              style={{
                padding: "14px 16px",
                borderBottom: "1px solid rgba(255,255,255,0.10)",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: "12px",
              }}
            >
              <div>
                <div
                  style={{
                    fontSize: "12px",
                    color: "rgba(232, 238, 248, 0.6)",
                    letterSpacing: "0.08em",
                    textTransform: "uppercase",
                  }}
                >
                  Map Project To Repo
                </div>
                <div
                  style={{
                    fontSize: "14px",
                    fontWeight: 750,
                    color: "#e8eef8",
                  }}
                >
                  {selectedProject
                    ? `${selectedProject.project.key}  ${selectedProject.project.name}`
                    : "Project"}
                </div>
              </div>

              <button
                type="button"
                className="nav-button"
                onClick={() => setRepoPickerOpen(false)}
              >
                Close
              </button>
            </div>

            <div
              style={{
                padding: "12px 16px",
                borderBottom: "1px solid rgba(255,255,255,0.10)",
                display: "flex",
                gap: "10px",
                alignItems: "center",
              }}
            >
              <input
                value={repoSearch}
                onChange={(e) => setRepoSearch(e.target.value)}
                placeholder="Search repos (owner/name)"
                style={{
                  flex: "1 1 auto",
                  background: "rgba(255,255,255,0.04)",
                  border: "1px solid rgba(255,255,255,0.12)",
                  borderRadius: "12px",
                  color: "#e8eef8",
                  padding: "10px 12px",
                  fontSize: "13px",
                  outline: "none",
                }}
              />
              <div
                style={{
                  fontSize: "12px",
                  color: "rgba(232,238,248,0.6)",
                }}
              >
                {repoOptions?.repos?.length
                  ? `${fmtCount(repoOptions.repos.length)} repos`
                  : ""}
              </div>
            </div>

            <div style={{ overflow: "auto", padding: "10px 10px" }}>
              {repoOptionsLoading ? (
                <div
                  style={{ padding: "14px", color: "rgba(232,238,248,0.65)" }}
                >
                  Loading repositories...
                </div>
              ) : repoOptionsError ? (
                <div
                  style={{
                    padding: "14px",
                    color: "rgba(255, 186, 110, 0.95)",
                  }}
                >
                  {repoOptionsError}
                </div>
              ) : repoOptions && repoOptions.connections.length === 0 ? (
                <div
                  style={{ padding: "14px", color: "rgba(232,238,248,0.7)" }}
                >
                  No Git providers connected. Go to{" "}
                  <a href="/settings">Settings</a> to connect GitHub (OAuth) or
                  Gitea (PAT).
                </div>
              ) : repoCandidates.length === 0 ? (
                <div
                  style={{ padding: "14px", color: "rgba(232,238,248,0.65)" }}
                >
                  No matches.
                </div>
              ) : (
                <div style={{ display: "grid", gap: "8px" }}>
                  {repoCandidates.slice(0, 200).map((r) => {
                    const isSelected = r.fullName === pendingRepoFullName;
                    const hasGitea = Boolean(r.sources.gitea);
                    const hasGitHub = Boolean(r.sources.github);
                    return (
                      <button
                        key={r.fullName}
                        type="button"
                        onClick={() => {
                          setPendingRepoFullName(r.fullName);
                          setPendingRepoProvider(r.preferred.provider);
                        }}
                        style={{
                          textAlign: "left",
                          padding: "10px 12px",
                          borderRadius: "14px",
                          border: isSelected
                            ? "1px solid rgba(100,160,255,0.35)"
                            : "1px solid rgba(255,255,255,0.10)",
                          background: isSelected
                            ? "rgba(100,160,255,0.09)"
                            : "rgba(255,255,255,0.03)",
                          color: "#e8eef8",
                          cursor: "pointer",
                          display: "flex",
                          justifyContent: "space-between",
                          gap: "10px",
                          alignItems: "center",
                        }}
                      >
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontWeight: 800, fontSize: "13px" }}>
                            {r.fullName}
                          </div>
                          <div
                            style={{
                              marginTop: "4px",
                              fontSize: "12px",
                              color: "rgba(232,238,248,0.55)",
                            }}
                          >
                            {r.preferred.isPrivate ? "private" : "public"} 
                            default: {r.preferred.defaultBranch}
                          </div>
                        </div>

                        <div
                          style={{
                            display: "flex",
                            gap: "6px",
                            alignItems: "center",
                            flex: "0 0 auto",
                          }}
                        >
                          {hasGitea ? (
                            <span
                              style={{
                                fontSize: "10px",
                                letterSpacing: "0.08em",
                                textTransform: "uppercase",
                                padding: "4px 8px",
                                borderRadius: "999px",
                                border: "1px solid rgba(255,255,255,0.10)",
                                background: "rgba(255,255,255,0.04)",
                                color: "rgba(232,238,248,0.7)",
                              }}
                            >
                              gitea
                            </span>
                          ) : null}
                          {hasGitHub ? (
                            <span
                              style={{
                                fontSize: "10px",
                                letterSpacing: "0.08em",
                                textTransform: "uppercase",
                                padding: "4px 8px",
                                borderRadius: "999px",
                                border: "1px solid rgba(255,255,255,0.10)",
                                background: "rgba(255,255,255,0.04)",
                                color: "rgba(232,238,248,0.7)",
                              }}
                            >
                              github
                            </span>
                          ) : null}
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            <div
              style={{
                padding: "12px 16px",
                borderTop: "1px solid rgba(255,255,255,0.10)",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: "12px",
              }}
            >
              <div
                style={{ display: "flex", gap: "8px", alignItems: "center" }}
              >
                <span
                  style={{
                    fontSize: "12px",
                    color: "rgba(232,238,248,0.6)",
                  }}
                >
                  Provider
                </span>
                <button
                  type="button"
                  className="nav-button"
                  onClick={() => setPendingRepoProvider("gitea")}
                  disabled={!availableProvidersForPending.includes("gitea")}
                  style={{
                    opacity: availableProvidersForPending.includes("gitea")
                      ? 1
                      : 0.4,
                    borderColor:
                      pendingRepoProvider === "gitea"
                        ? "rgba(100,160,255,0.45)"
                        : undefined,
                  }}
                >
                  Gitea
                </button>
                <button
                  type="button"
                  className="nav-button"
                  onClick={() => setPendingRepoProvider("github")}
                  disabled={!availableProvidersForPending.includes("github")}
                  style={{
                    opacity: availableProvidersForPending.includes("github")
                      ? 1
                      : 0.4,
                    borderColor:
                      pendingRepoProvider === "github"
                        ? "rgba(100,160,255,0.45)"
                        : undefined,
                  }}
                >
                  GitHub
                </button>
              </div>

              <div style={{ display: "flex", gap: "8px" }}>
                {repoOptionsError ? (
                  <div
                    style={{
                      fontSize: "12px",
                      color: "rgba(255, 186, 110, 0.95)",
                    }}
                  >
                    {repoOptionsError}
                  </div>
                ) : null}
                <button
                  type="button"
                  className="nav-button"
                  onClick={() => void mapSelectedRepo()}
                  disabled={
                    mappingBusy ||
                    !selectedProjectId ||
                    !selectedRepoOption ||
                    !availableProvidersForPending.includes(pendingRepoProvider)
                  }
                >
                  {mappingBusy ? "Mapping..." : "Map"}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {startSessionOpen ? (
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(5, 7, 11, 0.72)",
            display: "grid",
            placeItems: "center",
            padding: "20px",
            zIndex: 50,
          }}
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setStartSessionOpen(false);
          }}
        >
          <div
            style={{
              width: "min(680px, 100%)",
              borderRadius: "18px",
              border: "1px solid rgba(255,255,255,0.14)",
              background:
                "linear-gradient(180deg, rgba(12, 16, 24, 0.96), rgba(8, 10, 16, 0.94))",
              boxShadow:
                "0 24px 80px rgba(0,0,0,0.55), inset 0 1px 0 rgba(255,255,255,0.06)",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                padding: "14px 16px",
                borderBottom: "1px solid rgba(255,255,255,0.10)",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <div>
                <div
                  style={{
                    fontSize: "12px",
                    color: "rgba(232, 238, 248, 0.6)",
                    letterSpacing: "0.08em",
                    textTransform: "uppercase",
                  }}
                >
                  New Task / Agent Session
                </div>
                <div
                  style={{
                    fontSize: "14px",
                    fontWeight: 750,
                    color: "#e8eef8",
                  }}
                >
                  {selectedProject
                    ? `${selectedProject.project.key}  ${selectedProject.project.name}`
                    : "Project"}
                </div>
              </div>
              <button
                type="button"
                className="nav-button"
                onClick={() => setStartSessionOpen(false)}
              >
                Close
              </button>
            </div>

            <div style={{ padding: "14px 16px", display: "grid", gap: "10px" }}>
              <label
                style={{ fontSize: "12px", color: "rgba(232,238,248,0.6)" }}
              >
                Task identifier (optional)
              </label>
              <input
                value={taskIdentifier}
                onChange={(e) => setTaskIdentifier(e.target.value)}
                placeholder="PROJ-123"
                style={{
                  background: "rgba(255,255,255,0.04)",
                  border: "1px solid rgba(255,255,255,0.12)",
                  borderRadius: "12px",
                  color: "#e8eef8",
                  padding: "10px 12px",
                  fontSize: "13px",
                  outline: "none",
                }}
              />

              <label
                style={{ fontSize: "12px", color: "rgba(232,238,248,0.6)" }}
              >
                Branch name
              </label>
              <input
                value={newBranchName}
                onChange={(e) => setNewBranchName(e.target.value)}
                placeholder="feature/my-branch"
                style={{
                  background: "rgba(255,255,255,0.04)",
                  border: "1px solid rgba(255,255,255,0.12)",
                  borderRadius: "12px",
                  color: "#e8eef8",
                  padding: "10px 12px",
                  fontSize: "13px",
                  outline: "none",
                }}
              />

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: "10px",
                  alignItems: "end",
                }}
              >
                <div>
                  <label
                    style={{ fontSize: "12px", color: "rgba(232,238,248,0.6)" }}
                  >
                    Base branch (optional)
                  </label>
                  <input
                    value={baseBranch}
                    onChange={(e) => setBaseBranch(e.target.value)}
                    placeholder="main"
                    style={{
                      marginTop: "6px",
                      width: "100%",
                      background: "rgba(255,255,255,0.04)",
                      border: "1px solid rgba(255,255,255,0.12)",
                      borderRadius: "12px",
                      color: "#e8eef8",
                      padding: "10px 12px",
                      fontSize: "13px",
                      outline: "none",
                    }}
                  />
                </div>

                <div>
                  <label
                    style={{ fontSize: "12px", color: "rgba(232,238,248,0.6)" }}
                  >
                    Agent
                  </label>
                  <select
                    value={agentType}
                    onChange={(e) => setAgentType(e.target.value as AgentType)}
                    style={{
                      marginTop: "6px",
                      width: "100%",
                      background: "rgba(255,255,255,0.04)",
                      border: "1px solid rgba(255,255,255,0.12)",
                      borderRadius: "12px",
                      color: "#e8eef8",
                      padding: "10px 12px",
                      fontSize: "13px",
                      outline: "none",
                    }}
                  >
                    <option value="claude">claude</option>
                    <option value="kiro">kiro</option>
                    <option value="codex">codex</option>
                    <option value="gemini">gemini</option>
                    <option value="opencode">opencode</option>
                    <option value="cursor-agent">cursor-agent</option>
                  </select>
                </div>
              </div>
            </div>

            <div
              style={{
                padding: "12px 16px",
                borderTop: "1px solid rgba(255,255,255,0.10)",
                display: "flex",
                justifyContent: "flex-end",
                gap: "10px",
              }}
            >
              <button
                type="button"
                className="nav-button"
                onClick={() => void startSession()}
                disabled={startBusy}
              >
                {startBusy ? "Starting..." : "Create"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
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
