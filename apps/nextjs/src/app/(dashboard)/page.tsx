"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { TerminalComponent } from "~/components/dashboard/Terminal";
import { useCheatCode } from "~/contexts";
import { getAppConfig } from "~/lib/legacy/config";
import { api } from "~/lib/rest/api";

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
    branch: string | null;
    updatedAt: string | null;
    repository: {
      id: string;
      name: string;
      path: string;
      kanbangerProjectId: string | null;
    } | null;
  }>;
  activeInstances: Array<{
    id: string;
    agentType: string;
    status: string;
    worktreeId: string;
    branch: string | null;
    worktreePath: string | null;
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

function normalizeTaskFilter(value: string | null): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  return trimmed.toLowerCase();
}

function isMatchingTask(
  value: string | null | undefined,
  focusId: string | null,
): boolean {
  if (!focusId) return false;
  const candidate = value?.trim().toLowerCase();
  return Boolean(candidate && candidate === focusId);
}

function mappingLabel(error: string | null): string {
  if (!error) return "mapped";
  if (error === "unmapped") return "unmapped";
  if (error === "multiple_repos_mapped") return "ambiguous";
  return "mismatch";
}

function formatEventTime(value: string): string {
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return "now";
  const now = Date.now();
  const delta = Math.max(0, now - parsed);
  if (delta < 1000 * 60) return "just now";
  if (delta < 1000 * 60 * 60) return `${Math.floor(delta / (1000 * 60))}m ago`;
  if (delta < 1000 * 60 * 60 * 24)
    return `${Math.floor(delta / (1000 * 60 * 60))}h ago`;
  return `${Math.floor(delta / (1000 * 60 * 60 * 24))}d ago`;
}

function getCespFilterLabel(filter: "all" | CespSeverity): string {
  if (filter === "all") return "All";
  if (filter === "info") return "Info";
  if (filter === "warning") return "Warnings";
  return "Errors";
}

function projectDotStyle(
  color?: string | null,
  mapped = true,
): CSSProperties {
  return {
    "--dash-project-dot-color": color ?? "var(--dash-dimmer)",
    "--dash-project-dot-opacity": mapped ? "1" : "0.6",
  } as CSSProperties;
}

type ActiveProjectWorkGroup = {
  projectId: string;
  projectKey: string;
  projectName: string;
  projectColor: string;
  mapped: boolean;
  runs: DashboardV2["activeRuns"];
  instances: DashboardV2["activeInstances"];
};

type VisibleWorkstreamGroup = {
  group: ActiveProjectWorkGroup;
  visibleInstances: DashboardV2["activeInstances"];
  visibleRuns: DashboardV2["activeRuns"];
};

type TerminalSessionGroup = {
  projectId: string;
  projectKey: string;
  projectName: string;
  projectColor: string;
  mapped: boolean;
  sessions: TerminalSessionOption[];
};

type SessionScope = "all" | "instances" | "runs";

type TerminalSessionOption = {
  instanceId: string;
  sessionId: string;
  projectId: string;
  label: string;
  projectLabel: string;
  status?: string;
};

type CespSeverity = "info" | "warning" | "error";
type CespCategory =
  | "session.start"
  | "session.end"
  | "task.acknowledge"
  | "task.complete"
  | "task.error"
  | "input.required"
  | "resource.limit"
  | "task.progress"
  | "user.spam";

type CespDashboardAlert = {
  id: string;
  category: CespCategory;
  title: string;
  message: string;
  severity: CespSeverity;
  occurredAt: string;
  projectId?: string | null;
  repository?: {
    id: string;
    name: string;
    path: string;
    kanbangerProjectId: string | null;
  } | null;
  metadata: Record<string, unknown>;
};

type ConsoleDockMode = "floating" | "inline";

const SESSION_PROJECT_FILTER_KEY = "bob:dashboard:session-project-filter";
const SESSION_SCOPE_KEY = "bob:dashboard:session-scope";
const CONSOLE_DOCK_MODE_KEY = "bob:dashboard:console-dock-mode";
const CONSOLE_LAYOUT_BREAKPOINT = "(max-width: 900px)";

const UNMAPPED_PROJECT_ID = "__unmapped__";

function DashboardContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const { isDatabaseUnlocked } = useCheatCode();

  const [dash, setDash] = useState<DashboardV2 | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(
    null,
  );
  const [appName, setAppName] = useState("Bob");

  const taskFocusId = useMemo(
    () => normalizeTaskFilter(searchParams.get("task")),
    [searchParams],
  );

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

  const [activeTerminalSessionId, setActiveTerminalSessionId] = useState<
    string | null
  >(null);
  const [activeTerminalInstanceId, setActiveTerminalInstanceId] = useState<
    string | null
  >(null);
  const [openedInstanceSessions, setOpenedInstanceSessions] = useState<
    Map<string, string>
  >(new Map());
  const [terminalBusy, setTerminalBusy] = useState(false);
  const [sessionProjectFilter, setSessionProjectFilter] = useState<string>(
    () => {
      if (typeof window === "undefined") return "__all__";
      return (
        window.localStorage.getItem(SESSION_PROJECT_FILTER_KEY) ?? "__all__"
      );
    },
  );
  const [sessionScopeMode, setSessionScopeMode] = useState<SessionScope>(
    () => {
      if (typeof window === "undefined") return "all";
      return (
        (window.localStorage.getItem(SESSION_SCOPE_KEY) as SessionScope | null) ??
          "all"
      );
    },
  );
  const [cespAlerts, setCespAlerts] = useState<CespDashboardAlert[]>([]);
  const [cespAlertsLoading, setCespAlertsLoading] = useState(false);
  const [cespAlertsError, setCespAlertsError] = useState<string | null>(null);
  const [cespSeverityFilter, setCespSeverityFilter] = useState<
    "all" | CespSeverity
  >("all");
  const [consoleDockMode, setConsoleDockMode] = useState<ConsoleDockMode>(
    () => {
      if (typeof window === "undefined") return "floating";
      const savedMode =
        window.localStorage.getItem(CONSOLE_DOCK_MODE_KEY) ?? "floating";
      return savedMode === "inline" ? "inline" : "floating";
    },
  );
  const [isNarrowViewport, setIsNarrowViewport] = useState(false);

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

  const loadCespAlerts = useCallback(async () => {
    setCespAlertsLoading(true);
    setCespAlertsError(null);
    try {
      const since = new Date(Date.now() - 45 * 60 * 1000).toISOString();
      const response = await fetch(
        `/api/cesp/v1/alerts?since=${encodeURIComponent(since)}&limit=60`,
        {
          method: "GET",
          headers: { Accept: "application/json" },
          credentials: "include",
          cache: "no-store",
        },
      );
      if (!response.ok) {
        throw new Error(`Failed to load CESP alerts (HTTP ${response.status})`);
      }

      const body = (await response.json()) as {
        alerts?: CespDashboardAlert[];
      };
      const rawAlerts = Array.isArray(body.alerts) ? body.alerts : [];
      setCespAlerts(rawAlerts);
    } catch (error) {
      setCespAlertsError(
        error instanceof Error ? error.message : "Failed to load alerts",
      );
      setCespAlerts([]);
    } finally {
      setCespAlertsLoading(false);
    }
  }, [cespSeverityFilter]);

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
      setSessionProjectFilter(projectParam);
    }
    if (!projectParam && selectedProjectId) {
      setSelectedProjectId(null);
      setSessionProjectFilter("__all__");
    }
  }, [searchParams, selectedProjectId]);

  const taskFocusedRun = useMemo(() => {
    if (!taskFocusId || !dash?.activeRuns) return null;
    return (
      dash.activeRuns.find(
        (run) =>
          isMatchingTask(run.kanbangerIssueIdentifier, taskFocusId) ||
          isMatchingTask(run.kanbangerIssueId, taskFocusId),
      ) ?? null
    );
  }, [dash?.activeRuns, taskFocusId]);

  useEffect(() => {
    const projectFromTask = taskFocusedRun?.repository?.kanbangerProjectId ?? null;
    if (!projectFromTask) return;
    const hasProjectParam = searchParams.get("project");
    if (hasProjectParam !== projectFromTask) {
      updateUrlWithSelection("project", projectFromTask);
    }

    setSelectedProjectId((current) =>
      current === projectFromTask ? current : projectFromTask,
    );
    setSessionProjectFilter(projectFromTask);
  }, [taskFocusedRun, searchParams, updateUrlWithSelection]);

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

    return () => {
      cancelled = true;
    };
  }, [loadDashboard]);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      if (cancelled) return;
      try {
        await loadCespAlerts();
      } catch {
        // handled by load function
      }
    })();

    const interval = window.setInterval(() => {
      void loadCespAlerts();
    }, 45_000);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [loadCespAlerts]);

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

  const activeRunStats = useMemo(() => {
    const runs = dash?.activeRuns ?? [];
    const instances = dash?.activeInstances ?? [];
    return {
      running:
        runs.filter((r) => r.status === "running").length +
        instances.filter((i) => i.status === "running").length,
      starting:
        runs.filter((r) => r.status === "starting").length +
        instances.filter((i) => i.status === "starting").length,
      blocked: runs.filter((r) => r.status === "blocked").length,
    };
  }, [dash?.activeRuns, dash?.activeInstances]);

  const projects = dash?.projects ?? [];

  const selectedProject = useMemo(() => {
    if (!selectedProjectId) return null;
    return projects.find((p) => p.project.id === selectedProjectId) ?? null;
  }, [projects, selectedProjectId]);

  const projectsById = useMemo(() => {
    const index = new Map<string, (typeof projects)[number]>();
    for (const project of projects) {
      index.set(project.project.id, project);
    }
    return index;
  }, [projects]);

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

      await loadDashboard();
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
    newBranchName,
    selectedProjectId,
    taskIdentifier,
  ]);

  const handleOpenTerminal = useCallback(async (instanceId: string) => {
    if (terminalBusy) return;
    setTerminalBusy(true);
    try {
      const sessions = await api.getTerminalSessions(instanceId);
      const claudeSession = sessions.find((s) => s.type === "claude");
      let sessionId: string;
      if (claudeSession) {
        sessionId = claudeSession.id;
      } else {
        const created = await api.createTerminalSession(instanceId);
        sessionId = created.sessionId;
      }
      setActiveTerminalInstanceId(instanceId);
      setActiveTerminalSessionId(sessionId);
      setOpenedInstanceSessions((previous) => {
        const next = new Map(previous);
        next.set(instanceId, sessionId);
        return next;
      });
    } catch (e) {
      setMappingMessage(
        e instanceof Error ? e.message : "Failed to open terminal",
      );
    } finally {
      setTerminalBusy(false);
    }
  }, [terminalBusy]);

  const mappingErrors = useMemo(() => {
    return projects
      .filter((p) => p.mappingError)
      .map((p) => ({
        key: p.project.key,
        name: p.project.name,
        error: p.mappingError as string,
      }));
  }, [projects]);

  const visibleCespAlerts = useMemo(() => {
    const projectFilter = selectedProjectId
      ? selectedProjectId
      : sessionProjectFilter === "__all__"
        ? null
        : sessionProjectFilter;

    return cespAlerts.filter((alert) => {
      if (cespSeverityFilter !== "all" && alert.severity !== cespSeverityFilter) {
        return false;
      }
      const alertProjectId = alert.projectId ?? alert.repository?.kanbangerProjectId;
      if (projectFilter && alertProjectId && alertProjectId !== projectFilter) {
        return false;
      }
      if (taskFocusId) {
        const issue = alert.metadata?.issueId;
        if (
          typeof issue === "string" &&
          !isMatchingTask(issue, taskFocusId)
        ) {
          return false;
        }
      }
      return true;
    });
  }, [cespAlerts, cespSeverityFilter, sessionProjectFilter, selectedProjectId, taskFocusId]);

  const activeInstances = useMemo(() => dash?.activeInstances ?? [], [dash?.activeInstances]);

  const projectsSorted = useMemo(() => {
    return [...projects].sort((a, b) => a.project.key.localeCompare(b.project.key));
  }, [projects]);

  const activeWorkByProject = useMemo(() => {
    const out = new Map<string, { runs: number; instances: number }>();
    for (const run of dash?.activeRuns ?? []) {
      const projectId = run.repository?.kanbangerProjectId ?? UNMAPPED_PROJECT_ID;
      const entry = out.get(projectId) ?? { runs: 0, instances: 0 };
      entry.runs += 1;
      out.set(projectId, entry);
    }

    for (const instance of dash?.activeInstances ?? []) {
      const projectId =
        instance.repository?.kanbangerProjectId ?? UNMAPPED_PROJECT_ID;
      const entry = out.get(projectId) ?? { runs: 0, instances: 0 };
      entry.instances += 1;
      out.set(projectId, entry);
    }
    return out;
  }, [dash?.activeInstances, dash?.activeRuns]);

  const allWorkByProject = useMemo<ActiveProjectWorkGroup[]>(() => {
    const groups = new Map<string, ActiveProjectWorkGroup>();

    for (const run of dash?.activeRuns ?? []) {
      const projectId = run.repository?.kanbangerProjectId ?? UNMAPPED_PROJECT_ID;
      const project =
        projectId === UNMAPPED_PROJECT_ID
          ? null
          : projectsById.get(projectId) ?? null;
      const existing = groups.get(projectId);
      if (!existing) {
        groups.set(projectId, {
          projectId,
          projectKey: project?.project.key ?? "UNMAPPED PROJECTS",
          projectName: project?.project.name ?? "Tasks without mapping",
          projectColor: project?.project.color ?? "var(--dash-dimmer)",
          mapped: Boolean(project),
          runs: [run],
          instances: [],
        });
      } else {
        existing.runs.push(run);
      }
    }

    for (const instance of dash?.activeInstances ?? []) {
      const projectId = instance.repository?.kanbangerProjectId ?? UNMAPPED_PROJECT_ID;
      const project =
        projectId === UNMAPPED_PROJECT_ID
          ? null
          : projectsById.get(projectId) ?? null;
      const existing = groups.get(projectId);
      if (!existing) {
        groups.set(projectId, {
          projectId,
          projectKey: project?.project.key ?? "UNMAPPED PROJECTS",
          projectName: project?.project.name ?? "Instances without mapping",
          projectColor: project?.project.color ?? "var(--dash-dimmer)",
          mapped: Boolean(project),
          runs: [],
          instances: [instance],
        });
      } else {
        existing.instances.push(instance);
      }
    }

    return [...groups.values()].sort((a, b) =>
      a.projectKey.localeCompare(b.projectKey),
    );
  }, [dash?.activeInstances, dash?.activeRuns, projectsById]);

  const sessionProjectFilterOptions = useMemo(() => {
    return [
      { id: "__all__", label: "All work" },
      ...allWorkByProject.map((group) => ({
        id: group.projectId,
        label: group.projectKey,
      })),
    ];
  }, [allWorkByProject]);

  useEffect(() => {
    const validFilters = new Set(sessionProjectFilterOptions.map((option) => option.id));
    if (!validFilters.has(sessionProjectFilter)) {
      setSessionProjectFilter("__all__");
    }
  }, [sessionProjectFilter, sessionProjectFilterOptions]);

  useEffect(() => {
    const media = window.matchMedia(CONSOLE_LAYOUT_BREAKPOINT);
    const syncViewport = () => setIsNarrowViewport(media.matches);
    syncViewport();

    if (typeof media.addEventListener === "function") {
      media.addEventListener("change", syncViewport);
      return () => media.removeEventListener("change", syncViewport);
    }
    media.addListener(syncViewport);
    return () => media.removeListener(syncViewport);
  }, []);

  useEffect(() => {
    const safeScope = ["all", "instances", "runs"].includes(
      sessionScopeMode,
    )
      ? sessionScopeMode
      : "all";
    if (safeScope !== sessionScopeMode) {
      setSessionScopeMode(safeScope);
    }

    try {
      localStorage.setItem(SESSION_PROJECT_FILTER_KEY, sessionProjectFilter);
      localStorage.setItem(SESSION_SCOPE_KEY, sessionScopeMode);
      localStorage.setItem(CONSOLE_DOCK_MODE_KEY, consoleDockMode);
    } catch {
      // ignore
    }
  }, [consoleDockMode, sessionProjectFilter, sessionScopeMode]);

  useEffect(() => {
    if (activeInstances.length === 0) {
      setOpenedInstanceSessions((previous) => {
        if (previous.size === 0) return previous;
        return new Map();
      });
      if (activeTerminalSessionId) {
        setActiveTerminalSessionId(null);
        setActiveTerminalInstanceId(null);
      }
      return;
    }

    const activeInstanceIds = new Set(
      activeInstances.map((instance) => instance.id),
    );

    setOpenedInstanceSessions((previous) => {
      let changed = false;
      const next = new Map(previous);
      for (const id of previous.keys()) {
        if (!activeInstanceIds.has(id)) {
          next.delete(id);
          changed = true;
        }
      }
      if (!changed) return previous;
      return next;
    });

    if (
      activeTerminalInstanceId &&
      !activeInstanceIds.has(activeTerminalInstanceId)
    ) {
      setActiveTerminalSessionId(null);
      setActiveTerminalInstanceId(null);
    }
  }, [activeInstances, activeTerminalInstanceId, activeTerminalSessionId]);

  const activeSessionCount =
    activeInstances.length +
    (dash?.activeRuns?.length ? dash.activeRuns.length : 0);

  const terminalSessionOptions = useMemo(
    () => {
      if (openedInstanceSessions.size === 0) {
        return [] as TerminalSessionOption[];
      }

      const instanceById = new Map(activeInstances.map((instance) => [instance.id, instance]));

        return [...openedInstanceSessions.entries()]
        .map(([instanceId, sessionId]) => {
          const instance = instanceById.get(instanceId);
          const repoProjectId = instance?.repository?.kanbangerProjectId;
          const projectId = repoProjectId && repoProjectId.length > 0
            ? repoProjectId
            : UNMAPPED_PROJECT_ID;
          const project = repoProjectId
            ? projectsById.get(repoProjectId) ?? null
            : null;

          return {
            instanceId,
            sessionId,
            projectId,
            label:
              instance?.branch ?? instance?.worktreePath ?? instanceId,
            projectLabel: project
              ? project.project.key
              : projectId !== UNMAPPED_PROJECT_ID
                ? "Unmapped project"
                : "Unknown project",
            status: instance?.status,
            };
        })
        .sort((left, right) => {
          if (left.projectLabel === right.projectLabel) {
            return left.label.localeCompare(right.label);
          }
          return left.projectLabel.localeCompare(right.projectLabel);
        });
    },
    [activeInstances, openedInstanceSessions, projectsById],
  );

  const scopedTerminalSessionOptions = useMemo(
    () =>
      sessionProjectFilter === "__all__"
        ? terminalSessionOptions
        : terminalSessionOptions.filter(
            (option) => option.projectId === sessionProjectFilter,
          ),
    [sessionProjectFilter, terminalSessionOptions],
  );

  const terminalInstanceToProjectId = useMemo(() => {
    const lookup = new Map<string, string>();
    for (const instance of activeInstances) {
      const repoProjectId = instance.repository?.kanbangerProjectId;
      const projectId =
        repoProjectId && repoProjectId.length > 0
          ? repoProjectId
          : UNMAPPED_PROJECT_ID;
      lookup.set(instance.id, projectId);
    }
    return lookup;
  }, [activeInstances]);

  const terminalSessionProjectGroups = useMemo(() => {
    const groups = new Map<
      string,
      {
        projectId: string;
        projectKey: string;
        projectName: string;
        projectColor: string;
        mapped: boolean;
        sessions: TerminalSessionOption[];
      }
    >();

    for (const option of terminalSessionOptions) {
      const group = groups.get(option.projectId);
      if (!group) {
        const project = option.projectId
          ? projectsById.get(option.projectId) ?? null
          : null;
        groups.set(option.projectId, {
          projectId: option.projectId,
          projectKey: project?.project.key ?? "UNMAPPED PROJECTS",
          projectName: project?.project.name ?? "Unmapped project",
          projectColor: project?.project.color ?? "var(--dash-dimmer)",
          mapped: Boolean(project),
          sessions: [option],
        });
        continue;
      }
      group.sessions.push(option);
    }

    return [...groups.values()].sort((left, right) =>
      left.projectKey.localeCompare(right.projectKey),
    );
  }, [projectsById, terminalSessionOptions]);

  const selectedProjectTerminalGroups = useMemo(
    () =>
      selectedProjectId
        ? terminalSessionProjectGroups.filter(
            (group) => group.projectId === selectedProjectId,
          )
        : terminalSessionProjectGroups,
    [selectedProjectId, terminalSessionProjectGroups],
  );

  const selectedProjectTerminalSessions = useMemo(
    () =>
      selectedProjectTerminalGroups.flatMap((group) => group.sessions),
    [selectedProjectTerminalGroups],
  );

  const selectedProjectActiveTerminalSession = useMemo(
    () =>
      selectedProjectTerminalSessions.find(
        (session) => session.instanceId === activeTerminalInstanceId,
      ) ?? null,
    [activeTerminalInstanceId, selectedProjectTerminalSessions],
  );

  const getSessionDotStateClass = (status?: string) => {
    if (status === "running") return "is-running";
    if (status === "starting") return "is-warning";
    if (status === "blocked") return "is-danger";
    return "is-warning";
  };

  const getSessionPriority = (status?: string) => {
    if (status === "running") return "info";
    if (status === "stopped" || status === "blocked") return "error";
    if (status === "starting" || status === "initializing") return "warning";
    return "warning";
  };

  const getSessionPriorityLabel = (status?: string) => {
    const priority = getSessionPriority(status);
    return priority === "info" ? "live" : priority === "warning" ? "pending" : "critical";
  };

  const setActiveTerminalSessionByInstance = useCallback(
    (instanceId: string, sessionId: string) => {
      setActiveTerminalInstanceId(instanceId);
      setActiveTerminalSessionId(sessionId);
      const projectId = terminalInstanceToProjectId.get(instanceId);
      if (projectId) {
        setSessionProjectFilter(projectId);
      }
    },
    [terminalInstanceToProjectId],
  );

  const setActiveTerminalSessionByInstanceWithDock = useCallback(
    (instanceId: string, sessionId: string) => {
      setActiveTerminalSessionByInstance(instanceId, sessionId);
      if (!isNarrowViewport) {
        setConsoleDockMode("inline");
      }
    },
    [isNarrowViewport, setActiveTerminalSessionByInstance],
  );

  const setActiveTerminalSessionByIndex = useCallback(
    (index: number) => {
      if (scopedTerminalSessionOptions.length === 0) return;
      const clampedIndex =
        ((index % scopedTerminalSessionOptions.length) + scopedTerminalSessionOptions.length) %
        scopedTerminalSessionOptions.length;
      const session = scopedTerminalSessionOptions[clampedIndex];
      if (!session) return;
      setActiveTerminalSessionByInstanceWithDock(
        session.instanceId,
        session.sessionId,
      );
    },
    [scopedTerminalSessionOptions, setActiveTerminalSessionByInstanceWithDock],
  );

  const openInstanceTerminal = useCallback(
    (instanceId: string) => {
      const sessionId = openedInstanceSessions.get(instanceId);
      if (sessionId) {
        setActiveTerminalSessionByInstanceWithDock(instanceId, sessionId);
        return;
      }
      void handleOpenTerminal(instanceId);
    },
    [handleOpenTerminal, openedInstanceSessions, setActiveTerminalSessionByInstanceWithDock],
  );

  const cycleActiveTerminalSession = useCallback(
    (delta: number) => {
      if (scopedTerminalSessionOptions.length < 2) return;
      const currentIndex = scopedTerminalSessionOptions.findIndex(
        (option) => option.instanceId === activeTerminalInstanceId,
      );
      const baseIndex = currentIndex >= 0 ? currentIndex : 0;
      setActiveTerminalSessionByIndex(baseIndex + delta);
    },
    [
      activeTerminalInstanceId,
      scopedTerminalSessionOptions,
      setActiveTerminalSessionByIndex,
    ],
  );

  const cycleSelectedProjectTerminalSession = useCallback(
    (delta: number) => {
      if (selectedProjectTerminalSessions.length < 2) return;
      const currentIndex = selectedProjectTerminalSessions.findIndex(
        (session) => session.instanceId === activeTerminalInstanceId,
      );
      const baseIndex = currentIndex >= 0 ? currentIndex : 0;
      const clampedIndex =
        ((baseIndex + delta) % selectedProjectTerminalSessions.length +
          selectedProjectTerminalSessions.length) %
        selectedProjectTerminalSessions.length;
      const targetSession = selectedProjectTerminalSessions[clampedIndex];
      if (!targetSession) return;
      setActiveTerminalSessionByInstanceWithDock(
        targetSession.instanceId,
        targetSession.sessionId,
      );
    },
    [
      activeTerminalInstanceId,
      selectedProjectTerminalSessions,
      setActiveTerminalSessionByInstanceWithDock,
    ],
  );

  useEffect(() => {
    const handleKeydown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && (target.isContentEditable || /^(input|textarea|select)$/i.test(target.tagName))) {
        return;
      }

      if (event.key === "Escape" && activeTerminalSessionId) {
        setActiveTerminalSessionId(null);
        setActiveTerminalInstanceId(null);
        return;
      }

      if (!scopedTerminalSessionOptions.length) return;
      if (event.key === "ArrowLeft" && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        cycleActiveTerminalSession(-1);
        return;
      }
      if (event.key === "ArrowRight" && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        cycleActiveTerminalSession(1);
        return;
      }
      if (event.key === "ArrowUp" && event.altKey && selectedProjectId) {
        event.preventDefault();
        cycleSelectedProjectTerminalSession(-1);
        return;
      }
      if (event.key === "ArrowDown" && event.altKey && selectedProjectId) {
        event.preventDefault();
        cycleSelectedProjectTerminalSession(1);
        return;
      }
      if (event.key === "r" && (event.ctrlKey || event.metaKey)) {
        setSessionScopeMode((previous) =>
          previous === "all" ? "instances" : previous === "instances" ? "runs" : "all",
        );
        return;
      }
      if (event.key === "d" && (event.ctrlKey || event.metaKey)) {
        setConsoleDockMode((previous) =>
          previous === "floating" ? "inline" : "floating",
        );
        return;
      }

      if (
        event.key.length === 1 &&
        event.key >= "1" &&
        event.key <= "9" &&
        !event.shiftKey &&
        !event.altKey
      ) {
        const index = Number(event.key) - 1;
        if (index < scopedTerminalSessionOptions.length) {
          event.preventDefault();
          setActiveTerminalSessionByIndex(index);
        }
      }
    };

    window.addEventListener("keydown", handleKeydown);
    return () => window.removeEventListener("keydown", handleKeydown);
  }, [
    cycleSelectedProjectTerminalSession,
    selectedProjectId,
    activeTerminalSessionId,
    scopedTerminalSessionOptions.length,
    cycleActiveTerminalSession,
    setActiveTerminalSessionByIndex,
    setConsoleDockMode,
    setSessionScopeMode,
  ]);

  const scopeLanes = useMemo(
    () => {
      const out = {
        includeInstances: sessionScopeMode === "all" || sessionScopeMode === "instances",
        includeRuns: sessionScopeMode === "all" || sessionScopeMode === "runs",
      };
      return out;
    },
    [sessionScopeMode],
  );

  const visibleWorkGroups = useMemo(() => {
    const filteredGroups =
      sessionProjectFilter === "__all__"
        ? allWorkByProject
        : allWorkByProject.filter(
            (group) => group.projectId === sessionProjectFilter,
          );

    const withTaskScope =
      filteredGroups.length && taskFocusId
        ? filteredGroups.filter((group) =>
            group.instances.length > 0 ||
            group.runs.some(
              (run) =>
                isMatchingTask(run.kanbangerIssueIdentifier, taskFocusId) ||
                isMatchingTask(run.kanbangerIssueId, taskFocusId),
            ),
          )
        : filteredGroups;

    return withTaskScope.map((group) => {
      const visibleInstances = scopeLanes.includeInstances
        ? group.instances
        : [];
      const visibleRuns = scopeLanes.includeRuns ? group.runs : [];
      const taskFilteredRuns = taskFocusId
        ? visibleRuns.filter(
            (run) =>
              isMatchingTask(run.kanbangerIssueIdentifier, taskFocusId) ||
              isMatchingTask(run.kanbangerIssueId, taskFocusId),
          )
        : visibleRuns;

      return {
        group,
        visibleInstances,
        visibleRuns: taskFilteredRuns,
      };
    });
  }, [allWorkByProject, sessionProjectFilter, scopeLanes, taskFocusId]);

  const renderWorkstreamProject = useCallback(
    (entry: VisibleWorkstreamGroup) => {
      const { group } = entry;
      const totalWork = group.instances.length + group.runs.length;
      const displayedInstances = entry.visibleInstances;
      const displayedRuns = entry.visibleRuns;
      const highlightedRuns = displayedRuns.filter(
        (run) =>
          isMatchingTask(run.kanbangerIssueIdentifier, taskFocusId) ||
          isMatchingTask(run.kanbangerIssueId, taskFocusId),
      ).length;
      const hasAnyVisible =
        displayedInstances.length > 0 || displayedRuns.length > 0;
      const filteredCount = displayedInstances.length + displayedRuns.length;
      const terminalGroup = terminalSessionProjectGroups.find(
        (projectGroup) => projectGroup.projectId === group.projectId,
      );
      const terminalSessions = terminalGroup?.sessions ?? [];
      const terminalSessionCount = terminalSessions.length;
      const terminalSessionsPreview = terminalSessions.slice(0, 2);
      const remainingTerminalSessions = Math.max(0, terminalSessionCount - terminalSessionsPreview.length);

      return (
        <article key={group.projectId} className="dash-workstreamProject">
          <header className="dash-liveSessionProjectHeader">
            <span
              className="dash-liveSessionProjectDot"
              style={projectDotStyle(
                group.projectColor,
                group.mapped && group.projectColor !== "var(--dash-dimmer)",
              )}
            />
            <span className="dash-liveSessionProjectTitle">
              {group.projectKey}
            </span>
            <span className="dash-liveSessionProjectMeta">
              {fmtCount(filteredCount)}
              {sessionScopeMode === "all"
                ? " active"
                : sessionScopeMode === "instances"
                  ? " active instances"
                  : " active runs"}{" "}
            </span>
            {taskFocusId && highlightedRuns > 0 ? (
              <span className="dash-liveSessionProjectStatus">focus task</span>
            ) : null}
            {group.instances.some((instance) =>
              openedInstanceSessions.has(instance.id),
            ) ? (
              <span className="dash-liveSessionProjectStatus">console-ready</span>
            ) : null}
            <span className="dash-projectCount">
              {fmtCount(totalWork)} total
            </span>
          </header>

          <div className="dash-workstreamLanes">
            <section className="dash-workstreamLane">
              <div className="dash-workstreamLaneHeader">
                <span>Agent sessions</span>
                <span>{fmtCount(displayedInstances.length)}</span>
              </div>
              <div className="dash-workstreamLaneBody">
                {hasAnyVisible ? (
                  displayedInstances.length > 0 ? (
                    displayedInstances.map((instance) => {
                      const isOpen = openedInstanceSessions.has(instance.id);
                      const sessionId = openedInstanceSessions.get(instance.id);
                      return (
                        <button
                          key={instance.id}
                          type="button"
                          className={`dash-liveSessionChip ${
                            isOpen ? "is-active" : ""
                          }`}
                          onClick={() => {
                            if (sessionId) {
                              setActiveTerminalSessionByInstanceWithDock(
                                instance.id,
                                sessionId,
                              );
                              return;
                            }
                            void openInstanceTerminal(instance.id);
                          }}
                          disabled={terminalBusy}
                        >
                          <span
                            className={`dash-sessionDot ${getSessionDotStateClass(
                              instance.status,
                            )}`}
                          />
                          <span className="dash-liveSessionChipInfo">
                            <span>
                              {instance.branch ?? instance.agentType}
                            </span>
                            <span className="dash-terminalSessionSubline">
                              {instance.worktreePath ?? instance.id}
                            </span>
                          </span>
                          <span
                            className={`dash-sessionPriorityBadge is-${getSessionPriority(
                              instance.status,
                            )}`}
                          >
                            {getSessionPriorityLabel(instance.status)}
                          </span>
                          <span className="dash-sessionAction">
                            {terminalBusy &&
                            activeTerminalInstanceId === instance.id
                              ? "Opening..."
                              : isOpen
                                ? "Resume"
                                : "Open"}
                          </span>
                        </button>
                      );
                    })
                  ) : (
                    <div className="dash-workstreamLaneEmpty">No open sessions.</div>
                  )
                ) : (
                  <div className="dash-workstreamLaneEmpty">No sessions for this lane.</div>
                )}
              </div>
            </section>

            <section className="dash-workstreamLane">
              <div className="dash-workstreamLaneHeader">
                <span>Task runs</span>
                <span>{fmtCount(displayedRuns.length)}</span>
              </div>
              <div className="dash-workstreamLaneBody">
                {hasAnyVisible ? (
                  displayedRuns.length > 0 ? (
                      displayedRuns.map((run) => (
                      <div
                        key={run.id}
                        className={`dash-liveSessionChip is-static ${
                          isMatchingTask(run.kanbangerIssueIdentifier, taskFocusId) ||
                          isMatchingTask(run.kanbangerIssueId, taskFocusId)
                            ? "is-focused"
                            : ""
                        }`}
                      >
                        <span
                          className={`dash-sessionDot ${getSessionDotStateClass(
                            run.status,
                          )}`}
                        />
                        <span className="dash-liveSessionChipInfo">
                          <span>{run.kanbangerIssueIdentifier}</span>
                          {run.branch ? (
                            <span className="dash-terminalSessionSubline">
                              {run.branch}
                            </span>
                          ) : null}
                          {run.blockedReason ? (
                            <span className="dash-terminalSessionSubline is-warning">
                              {run.blockedReason}
                            </span>
                          ) : null}
                        </span>
                        <span
                          className={`dash-sessionPriorityBadge is-${getSessionPriority(
                            run.status,
                          )}`}
                        >
                          {getSessionPriorityLabel(run.status)}
                        </span>
                        <span className="dash-sessionAction">{run.status}</span>
                      </div>
                    ))
                  ) : (
                    <div className="dash-workstreamLaneEmpty">No task runs.</div>
                  )
                ) : (
                  <div className="dash-workstreamLaneEmpty">No sessions for this lane.</div>
                )}
              </div>
            </section>
          </div>
          <div className="dash-workstreamProjectSessionStrip">
            <div className="dash-workstreamProjectSessionHeader">
              <span>Open terminal sessions</span>
              <span>{fmtCount(terminalSessionCount)} shown</span>
            </div>
            <div className="dash-workstreamProjectSessionList">
              {terminalSessionCount > 0 ? (
                terminalSessionsPreview.map((terminalSession) => (
                  <button
                    type="button"
                    key={terminalSession.instanceId}
                    className={`dash-liveSessionChip is-static ${
                      activeTerminalInstanceId === terminalSession.instanceId
                        ? "is-active"
                        : ""
                    }`}
                    onClick={() => {
                      setActiveTerminalSessionByInstanceWithDock(
                        terminalSession.instanceId,
                        terminalSession.sessionId,
                      );
                    }}
                  >
                    <span
                      className={`dash-sessionDot ${getSessionDotStateClass(
                        terminalSession.status,
                      )}`}
                    />
                    <span className="dash-liveSessionChipInfo">
                      <span>{terminalSession.label}</span>
                      <span className="dash-terminalSessionSubline">
                        {terminalSession.projectLabel}
                      </span>
                    </span>
                    <span
                      className={`dash-sessionPriorityBadge is-${getSessionPriority(
                        terminalSession.status,
                      )}`}
                    >
                      {getSessionPriorityLabel(terminalSession.status)}
                    </span>
                  </button>
                ))
              ) : (
                <div className="dash-workstreamLaneEmpty">No terminal sessions.</div>
              )}
              {remainingTerminalSessions > 0 ? (
                <div className="dash-workstreamLaneEmpty">
                  +{fmtCount(remainingTerminalSessions)} more terminal session
                  {remainingTerminalSessions === 1 ? "" : "s"}
                </div>
              ) : null}
            </div>
          </div>
        </article>
      );
    },
    [
      getSessionPriority,
      getSessionPriorityLabel,
      activeTerminalInstanceId,
      getSessionDotStateClass,
      openInstanceTerminal,
      setActiveTerminalSessionByInstanceWithDock,
      sessionScopeMode,
      taskFocusId,
      terminalBusy,
      openedInstanceSessions,
      terminalSessionProjectGroups,
    ],
  );

  const renderCespAlertFeed = useCallback(
    (alerts: CespDashboardAlert[]) => {
      if (alerts.length === 0) {
        return (
          <div className="dash-emptyState">
            {selectedProjectId
              ? "No alert activity for this project in the last 45 minutes."
              : "No alert activity in the selected scope."}
          </div>
        );
      }

      return (
        <div className="dash-cespFeedList">
          {alerts.map((alert) => {
            const alertProjectId =
              alert.projectId ?? alert.repository?.kanbangerProjectId ?? null;
            const isActionable = alert.metadata?.issueId;
            const issueId =
              typeof isActionable === "string" && isActionable.trim().length > 0
                ? isActionable.trim()
                : null;
            const projectLabel = alert.repository?.name || alertProjectId || "General";

            return (
              <button
                key={alert.id}
                type="button"
                className={`dash-cespFeedItem is-${alert.severity}`}
                onClick={() => {
                  if (alertProjectId) {
                    setSessionProjectFilter(alertProjectId);
                    updateUrlWithSelection("project", alertProjectId);
                    setSelectedProjectId(alertProjectId);
                  }
                  if (issueId) {
                    updateUrlWithSelection("task", issueId);
                  } else if (alertProjectId) {
                    setSessionProjectFilter(alertProjectId);
                    setSelectedProjectId(alertProjectId);
                  } else {
                    setSelectedProjectId(null);
                    setSessionProjectFilter("__all__");
                    updateUrlWithSelection("project", null);
                  }
                }}
              >
                <span className={`dash-cespFeedBadge is-${alert.severity}`} />
                <span className="dash-cespFeedMain">
                  <span className="dash-cespFeedTitle">
                    {alert.title}
                  </span>
                  <span className="dash-cespFeedMessage">{alert.message}</span>
                </span>
                <span className="dash-cespFeedMeta">
                  <span>{projectLabel}</span>
                  <span>{formatEventTime(alert.occurredAt)}</span>
                </span>
              </button>
            );
          })}
        </div>
      );
    },
    [
      selectedProjectId,
      setSessionProjectFilter,
      setSelectedProjectId,
      updateUrlWithSelection,
    ],
  );

  const renderTerminalSessionGroups = useCallback(
    (groups: TerminalSessionGroup[]) => {
      if (groups.length === 0) {
        return (
          <div className="dash-emptyState">No terminal sessions yet.</div>
        );
      }

      return (
        <div className="dash-terminalProjectList">
          {groups.map((group) => (
            <div
              key={group.projectId}
              className="dash-terminalProjectGroup"
            >
              <div className="dash-terminalProjectHeader">
                <span
                  className="dash-liveSessionProjectDot"
                  style={projectDotStyle(
                    group.projectColor,
                    group.mapped &&
                      group.projectColor !== "var(--dash-dimmer)",
                  )}
                />
                <button
                  type="button"
                  className="dash-terminalProjectTitle"
                  onClick={() => setSessionProjectFilter(group.projectId)}
                >
                  {group.projectKey}
                </button>
                <span className="dash-terminalProjectMeta">
                  {fmtCount(group.sessions.length)}
                  {group.sessions.length === 1 ? " session" : " sessions"}
                </span>
              </div>
              <div className="dash-terminalSessionRail">
                {group.sessions.map((sessionOption) => {
                  const isActive =
                    sessionOption.instanceId === activeTerminalInstanceId;
                  return (
                    <button
                      type="button"
                      key={sessionOption.instanceId}
                      className={`dash-terminalSessionChip ${
                        isActive ? "is-active" : ""
                      }`}
                      onClick={() => {
                        setActiveTerminalSessionByInstanceWithDock(
                          sessionOption.instanceId,
                          sessionOption.sessionId,
                        );
                      }}
                    >
                      <span
                        className={`dash-sessionDot ${getSessionDotStateClass(
                          sessionOption.status,
                        )}`}
                      />
                      <span className="dash-terminalSessionChipInfo">
                        <span>{sessionOption.label}</span>
                        <span className="dash-terminalSessionSubline">
                          {sessionOption.projectLabel}
                          {sessionOption.sessionId ? (
                            <>
                              {" "}
                              · {sessionOption.sessionId.slice(-8)}
                            </>
                          ) : null}
                        </span>
                        {terminalBusy && activeTerminalInstanceId === sessionOption.instanceId ? (
                          <span className="dash-terminalSessionSubline is-warning">
                            Opening session
                          </span>
                        ) : null}
                        <span
                          className={`dash-sessionPriorityBadge is-${getSessionPriority(
                            sessionOption.status,
                          )}`}
                        >
                          {getSessionPriorityLabel(sessionOption.status)}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      );
    },
    [
      activeTerminalInstanceId,
      getSessionDotStateClass,
      getSessionPriority,
      getSessionPriorityLabel,
      setActiveTerminalSessionByInstanceWithDock,
      setSessionProjectFilter,
      terminalBusy,
    ],
  );

  const selectedProjectVisibleWorkGroup = useMemo<VisibleWorkstreamGroup | null>(() => {
    if (!selectedProjectId) return null;
    return (
      visibleWorkGroups.find((group) => group.group.projectId === selectedProjectId) ??
      null
    );
  }, [selectedProjectId, visibleWorkGroups]);

  const selectedProjectVisibleWork = useMemo(() => {
    const visibleRuns = selectedProjectVisibleWorkGroup?.visibleRuns ?? [];
    const visibleInstances =
      selectedProjectVisibleWorkGroup?.visibleInstances ?? [];
    return {
      visibleRuns,
      visibleInstances,
      count: visibleRuns.length + visibleInstances.length,
    };
  }, [selectedProjectVisibleWorkGroup]);

  const filteredTerminalSessionOptions = scopedTerminalSessionOptions;

  const filteredTerminalSessionProjectGroups = useMemo(() => {
    if (sessionProjectFilter === "__all__") {
      return terminalSessionProjectGroups;
    }
    return terminalSessionProjectGroups.filter(
      (group) => group.projectId === sessionProjectFilter,
    );
  }, [sessionProjectFilter, terminalSessionProjectGroups]);

  const activeTerminalSessionIndex = useMemo(() => {
    if (!activeTerminalInstanceId) return -1;
    return terminalSessionOptions.findIndex(
      (option) => option.instanceId === activeTerminalInstanceId,
    );
  }, [terminalSessionOptions, activeTerminalInstanceId]);

  const activeTerminalSessionIndexInScope = useMemo(() => {
    if (!activeTerminalInstanceId) return -1;
    return scopedTerminalSessionOptions.findIndex(
      (option) => option.instanceId === activeTerminalInstanceId,
    );
  }, [activeTerminalInstanceId, scopedTerminalSessionOptions]);

  const showInlineConsole =
    activeTerminalSessionId !== null &&
    consoleDockMode === "inline" &&
    !isNarrowViewport;

  const scopeOptions = [
    { id: "all", label: "All" },
    { id: "instances", label: "Instances" },
    { id: "runs", label: "Runs" },
  ] as const;

  const renderConsoleSessionStrip = useCallback(
    (
      options: TerminalSessionOption[],
      title = "Quick switch across active sessions",
      className = "",
    ) =>
      options.length === 0 ? null : (
        <div className={`dash-consoleSessionStrip ${className}`}>
          <div className="dash-consoleSessionStripTitle">
            {title}
          </div>
          <div className="dash-consoleSessionStripRail">
            {options.map((option, index) => {
              const isActive = activeTerminalInstanceId === option.instanceId;
              return (
                <button
                  type="button"
                  key={option.instanceId}
                  className={`dash-consoleSessionStripChip ${
                    isActive ? "is-active" : ""
                  }`}
                  onClick={() =>
                    setActiveTerminalSessionByInstanceWithDock(
                      option.instanceId,
                      option.sessionId,
                    )
                  }
                  disabled={terminalBusy && activeTerminalInstanceId !== option.instanceId}
                  title={`${option.label} · ${option.projectLabel}`}
                >
                  <span
                    className={`dash-sessionDot ${getSessionDotStateClass(
                      option.status,
                    )}`}
                  />
                  <span className="dash-consoleSessionStripMeta">
                    <span className="dash-consoleSessionStripPrimary">
                      {option.label}
                    </span>
                    <span className="dash-consoleSessionStripSecondary">
                      {option.projectLabel}
                    </span>
                  </span>
                  <span className="dash-consoleSessionStripBadge">
                    #{index + 1}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      ),
    [
      activeTerminalInstanceId,
      getSessionDotStateClass,
      setActiveTerminalSessionByInstanceWithDock,
      terminalBusy,
    ],
  );

  const consolePanel = (modifier: "floating" | "inline") => {
    if (!activeTerminalSessionId) return null;
    const activeSessionChip =
      activeTerminalSessionIndex >= 0
        ? terminalSessionOptions[activeTerminalSessionIndex]
        : null;
    const activeSessionProject = activeSessionChip
      ? projectsById.get(activeSessionChip.projectId) ?? null
      : null;
    const activeSessionProjectLabel = activeSessionProject?.project.key ?? activeSessionChip?.projectLabel;
    const activeSessionProjectId = activeSessionChip?.projectId ?? null;

    return (
      <div className={`dash-consoleDock ${modifier === "inline" ? "is-inline" : ""}`}>
        <div className="dash-terminalPanel">
          <div className="dash-terminalHeader">
            <div className="dash-terminalHeaderInfo">
              <div className="dash-terminalTitle">Console</div>
              <div className="dash-terminalInstance" title={activeTerminalInstanceId ?? ""}>
                {activeSessionChip ? activeSessionChip.label : activeTerminalInstanceId}
              </div>
              <div className="dash-terminalCounter">
                {fmtCount(openedInstanceSessions.size)} connected terminal
                session{openedInstanceSessions.size === 1 ? "" : "s"}
                {activeSessionChip
                  ? ` · ${activeSessionChip.projectLabel}`
                  : ""}
              </div>
              {terminalSessionProjectGroups.length > 1 ? (
                <div className="dash-consoleProjectStrip">
                  <button
                    type="button"
                    className={`dash-consoleProjectChip ${
                      sessionProjectFilter === "__all__" ? "is-active" : ""
                    }`}
                    onClick={() => setSessionProjectFilter("__all__")}
                  >
                    All sessions
                  </button>
                  {terminalSessionProjectGroups.map((group) => (
                    <button
                      key={group.projectId}
                      type="button"
                      className={`dash-consoleProjectChip ${
                        sessionProjectFilter === group.projectId ? "is-active" : ""
                      }`}
                      onClick={() => setSessionProjectFilter(group.projectId)}
                    >
                      {group.projectKey}
                    </button>
                  ))}
                </div>
              ) : null}
              {activeTerminalSessionIndex >= 0 ? (
                <div className="dash-consoleBreadcrumb">
                  <span className="dash-consoleBreadcrumbLabel">Context</span>
                  <button
                    type="button"
                    className="dash-consoleBreadcrumbItem"
                    onClick={() => setSessionProjectFilter("__all__")}
                  >
                    All sessions
                  </button>
                  {activeSessionProjectId ? (
                    <button
                      type="button"
                      className={`dash-consoleBreadcrumbItem ${
                        sessionProjectFilter === activeSessionProjectId
                          ? "is-active"
                          : ""
                      }`}
                      onClick={() => setSessionProjectFilter(activeSessionProjectId)}
                    >
                      {activeSessionProjectLabel}
                    </button>
                  ) : null}
                  {activeSessionChip ? (
                    <button
                      type="button"
                      className="dash-consoleBreadcrumbItem is-active"
                      onClick={() =>
                        setActiveTerminalSessionByInstanceWithDock(
                          activeSessionChip.instanceId,
                          activeSessionChip.sessionId,
                        )
                      }
                    >
                      {activeSessionChip.label}
                    </button>
                  ) : null}
                </div>
              ) : null}
              {activeSessionChip ? (
                <div className="dash-consoleBreadcrumbMeta">
                  {activeSessionChip.projectLabel} ·{" "}
                  {getSessionPriorityLabel(activeSessionChip.status)} priority
                </div>
              ) : null}
            </div>
            {activeTerminalSessionIndexInScope >= 0 &&
            scopedTerminalSessionOptions.length > 1 ? (
              <div className="dash-consolePager">
                <button
                  type="button"
                  className="dash-consolePagerButton"
                  onClick={() => cycleActiveTerminalSession(-1)}
                  title="Previous active session"
                >
                  ←
                </button>
                <span className="dash-consolePagerCounter">
                  {activeTerminalSessionIndexInScope + 1} of{" "}
                  {fmtCount(scopedTerminalSessionOptions.length)}
                </span>
                <button
                  type="button"
                  className="dash-consolePagerButton"
                  onClick={() => cycleActiveTerminalSession(1)}
                  title="Next active session"
                >
                  →
                </button>
              </div>
            ) : null}
            <div className="dash-consoleQuickActions">
              <button
                type="button"
                className={`dash-consoleQuickButton ${
                  consoleDockMode === "inline" ? "is-active" : ""
                }`}
                onClick={() => setConsoleDockMode("inline")}
                title="Dock console inline"
              >
                Inline
              </button>
              <button
                type="button"
                className={`dash-consoleQuickButton ${
                  consoleDockMode === "floating" ? "is-active" : ""
                }`}
                onClick={() => setConsoleDockMode("floating")}
                title="Float console"
              >
                Floating
              </button>
              <button
                type="button"
                className="nav-button dash-terminalClose"
                onClick={() => {
                  setActiveTerminalSessionId(null);
                  setActiveTerminalInstanceId(null);
                }}
              >
                Close
              </button>
            </div>
          </div>
          {renderConsoleSessionStrip(filteredTerminalSessionOptions)}
          {terminalSessionOptions.length > 0 ? (
            <div className="dash-terminalSessionDeck">
              {renderTerminalSessionGroups(
                sessionProjectFilter === "__all__"
                  ? terminalSessionProjectGroups
                  : terminalSessionProjectGroups.filter(
                      (group) => group.projectId === sessionProjectFilter,
                    ),
              )}
            </div>
          ) : null}
          <div className="dash-terminalBody">
            <TerminalComponent
              key={activeTerminalSessionId}
              sessionId={activeTerminalSessionId}
              onClose={() => {
                setActiveTerminalSessionId(null);
                setActiveTerminalInstanceId(null);
              }}
            />
          </div>
        </div>
      </div>
    );
  };

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
                setSessionProjectFilter("__all__");
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
            <div className="dash-agentMeta" title="Active task runs">
              <span className="dash-metaLabel">Runs</span>
              <span className="dash-metaValue">
                {fmtCount(activeRunStats.running)} running
              </span>
              <span className="dash-metaDim">
                {fmtCount(activeRunStats.starting)} starting
              </span>
              {activeRunStats.blocked ? (
                <span className="dash-metaWarn">
                  {fmtCount(activeRunStats.blocked)} blocked
                </span>
              ) : null}
            </div>
          </div>
        </div>

        <div className="dash-overview">
          <div className="dash-overviewTitle">
            <div className="dash-dashboardHeaderLabel">Workspace status</div>
            <div className="dash-dashboardHeaderTitle">
              {dash ? dash.workspace.name : "Kanbanger unavailable"}
            </div>
          </div>

          <div className="dash-statGrid">
            <div className="dash-statCard">
              <div className="dash-statLabel">Tasks in progress</div>
              <div className="dash-statValue">
                {dash ? fmtCount(dash.totals.inProgress) : "-"}
              </div>
              <div className="dash-statHint">Open work in the queue</div>
            </div>

            <div className="dash-statCard">
              <div className="dash-statLabel">In review / testing</div>
              <div className="dash-statValue">
                {dash ? fmtCount(dash.totals.inReview) : "-"}
              </div>
              <div className="dash-statHint">Awaiting merge or confirmation</div>
            </div>

            <div className="dash-statCard">
              <div className="dash-statLabel">Done (last 24h)</div>
              <div className="dash-statValue">
                {dash ? fmtCount(dash.totals.doneLast24h) : "-"}
              </div>
              <div className="dash-statHint">By updatedAt and completion</div>
            </div>
          </div>
        </div>
      </header>

      <div className="dash-dashboardWorkspace">
        <aside className="dash-workspaceRail">
          <section className="dash-sideCard">
            <div className="dash-sideHeader">
              <div>
                <div className="dash-sideLabel">Live sessions grouped by project</div>
                <div className="dash-sideTitle">
                  {activeSessionCount === 0
                    ? "No active sessions"
                    : `${fmtCount(activeSessionCount)} active sessions`}
                </div>
              </div>
              {activeTerminalSessionId ? (
                <button
                  type="button"
                  className="nav-button"
                  onClick={() => {
                    setActiveTerminalSessionId(null);
                    setActiveTerminalInstanceId(null);
                  }}
                >
                  Hide console
                </button>
              ) : null}
            </div>

            <div className="dash-sideBody">
            {activeSessionCount === 0 ? (
              <div className="dash-emptyState">No active sessions now.</div>
            ) : (
              <>
                  {sessionProjectFilterOptions.length > 1 ? (
                    <div className="dash-sessionFilterRow">
                      {sessionProjectFilterOptions.map((option) => {
                        const optionGroup =
                          option.id === "__all__"
                            ? null
                            : allWorkByProject.find(
                                (group) => group.projectId === option.id,
                              );
                        const optionCount =
                          option.id === "__all__"
                            ? activeSessionCount
                            : optionGroup
                              ? optionGroup.instances.length + optionGroup.runs.length
                              : 0;
                        return (
                          <button
                            type="button"
                            key={option.id}
                            className={`dash-sessionFilterChip ${
                              sessionProjectFilter === option.id ? "is-active" : ""
                            }`}
                            onClick={() => setSessionProjectFilter(option.id)}
                          >
                            <span>{option.label}</span>
                            <span>· {optionCount}</span>
                          </button>
                        );
                      })}
                    </div>
                  ) : null}

                  <div className="dash-sessionScopeRow">
                    {scopeOptions.map((scope) => (
                      <button
                        type="button"
                        key={scope.id}
                        className={`dash-sessionScopeChip ${
                          sessionScopeMode === scope.id ? "is-active" : ""
                        }`}
                        onClick={() => setSessionScopeMode(scope.id)}
                      >
                        {scope.label}
                      </button>
                    ))}
                  </div>

                  <div className="dash-workstreamList">
                    {visibleWorkGroups.length ? (
                      visibleWorkGroups.map(renderWorkstreamProject)
                    ) : (
                      <div className="dash-emptyState">
                        No active sessions for this filter.
                      </div>
                    )}
                  </div>

                  <div className="dash-worktreeSessionRailPanel">
                    <div className="dash-worktreeSessionRailTitle">
                      Open terminal sessions
                    </div>
                    {filteredTerminalSessionProjectGroups.length > 0 ? (
                      renderTerminalSessionGroups(
                        filteredTerminalSessionProjectGroups,
                      )
                    ) : (
                      <div className="dash-worktreeSessionEmpty">
                        No terminal sessions in this scope.
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
          </section>

          <section className="dash-sideCard">
            <div className="dash-sideHeader">
              <div>
                <div className="dash-sideLabel">Live events</div>
                <div className="dash-sideTitle">
                  {fmtCount(visibleCespAlerts.length)} alerts
                </div>
              </div>
              <button
                type="button"
                className="nav-button"
                onClick={() => void loadCespAlerts()}
              >
                Refresh
              </button>
            </div>

            <div className="dash-sideBody">
              <div className="dash-sessionFilterRow">
                {(["all", "info", "warning", "error"] as const).map((filter) => (
                  <button
                    key={filter}
                    type="button"
                    className={`dash-sessionFilterChip ${
                      cespSeverityFilter === filter ? "is-active" : ""
                    }`}
                    onClick={() => setCespSeverityFilter(filter)}
                  >
                    {getCespFilterLabel(filter)}
                  </button>
                ))}
              </div>
              {cespAlertsLoading && (
                <div className="dash-emptyState">Fetching latest events...</div>
              )}
              {cespAlertsError ? (
                <div className="dash-emptyState dash-cespFeedError">
                  {cespAlertsError}
                </div>
              ) : null}
              {visibleCespAlerts.length === 0 && !cespAlertsLoading && !cespAlertsError ? (
                <div className="dash-emptyState">
                  No events in this project scope.
                </div>
              ) : (
                renderCespAlertFeed(visibleCespAlerts.slice(0, 6))
              )}
            </div>
          </section>

          <section className="dash-sideCard">
            <div className="dash-sideHeader">
              <div>
                <div className="dash-sideLabel">Projects</div>
                <div className="dash-sideTitle">
                  {dash ? fmtCount(projectsSorted.length) : "-"}
                </div>
              </div>
              {mappingErrors.length ? (
                <button
                  type="button"
                  className="nav-button"
                  onClick={() => {
                    setSelectedProjectId(null);
                    updateUrlWithSelection("project", null);
                  }}
                >
                  Fix mappings
                </button>
              ) : null}
            </div>

            <div className="dash-sideBody">
              {!dash ? (
                <div className="dash-emptyState">Kanbanger unavailable</div>
              ) : (
                <div className="dash-projectNavList">
                  <button
                    type="button"
                    className="dash-projectNavButton is-all"
                    onClick={() => {
                      setSelectedProjectId(null);
                      updateUrlWithSelection("project", null);
                      setSessionProjectFilter("__all__");
                    }}
                  >
                    <span>
                      <span className="dash-projectKey">All projects</span>
                      <span className="dash-projectSubtitle">
                        Workspace overview
                      </span>
                    </span>
                    <span className="dash-projectCount">
                      {fmtCount(activeSessionCount)}
                    </span>
                  </button>

                  {projectsSorted.map((p) => {
                    const isActive = p.project.id === selectedProjectId;
                    const activeForProject = activeWorkByProject.get(p.project.id);
                    return (
                      <button
                        key={p.project.id}
                        type="button"
                        className={`dash-projectNavButton ${
                          isActive ? "is-active" : ""
                        }`}
                        onClick={() => {
                          setSelectedProjectId(p.project.id);
                          updateUrlWithSelection("project", p.project.id);
                          setSessionProjectFilter(p.project.id);
                        }}
                      >
                        <span
                          className="dash-projectChipDot"
                          style={projectDotStyle(p.project.color)}
                        />
                        <span>
                          <span className="dash-projectKey">{p.project.key}</span>
                          <span className="dash-projectSubtitle">
                            {p.project.name}
                          </span>
                          <span className="dash-projectSubtitle">
                            In progress {fmtCount(p.counts.inProgress)} • In review {" "}
                            {fmtCount(p.counts.inReview)}
                          </span>
                        </span>
                        <span className="dash-projectCount">
                          {activeForProject
                            ? fmtCount(
                                activeForProject.runs + activeForProject.instances,
                              )
                            : "0"}
                        </span>
                        <span
                          className={`dash-projectStatus ${
                            p.mappingError ? "is-error" : "is-mapped"
                          }`}
                          title={p.mappingError ?? "mapped"}
                        >
                          {mappingLabel(p.mappingError)}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </section>
        </aside>

        <main
          className={`dash-projectWorkspacePanel${
            showInlineConsole ? " is-inline-console" : ""
          }`}
        >
          <div className="dash-projectWorkspaceHeader">
            <div className="dash-dashboardHeaderRow">
              <div>
                <div className="dash-dashboardHeaderLabel">Dashboard</div>
                <div className="dash-dashboardHeaderTitle">
                  {selectedProject
                    ? `${selectedProject.project.key} · ${selectedProject.project.name}`
                    : "All projects"}
                </div>
              </div>
              <div className="dash-dashboardHeaderActions">
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
                  <div className="dash-warningText">
                    Mapping mismatch: {selectedProject.mappingError}
                  </div>
                ) : null}
                <div className="dash-workMode">
                  <button
                    type="button"
                    className={`dash-workModeButton ${
                      sessionProjectFilter === "__all__" ? "is-active" : ""
                    }`}
                    onClick={() => setSessionProjectFilter("__all__")}
                  >
                    All sessions
                  </button>
                  {selectedProject ? (
                    <button
                      type="button"
                      className={`dash-workModeButton ${
                        sessionProjectFilter === selectedProject.project.id
                          ? "is-active"
                          : ""
                      }`}
                      onClick={() => setSessionProjectFilter(selectedProject.project.id)}
                    >
                      This project
                    </button>
                  ) : null}
                </div>
              </div>
            </div>
          </div>

          <div className="dash-projectWorkspaceContent">
            {!dash ? (
              <div className="loading">Loading dashboard...</div>
            ) : selectedProject ? (
              <div className="dash-stackGap14">
                <div className="dash-projectRow">
                  <div className="dash-projectRowHeader">
                    <div className="dash-projectRowTitle">Repository</div>
                    <div className="dash-projectRowMeta">
                      {selectedProject.repository ? "mapped" : "unmapped"}
                    </div>
                  </div>
                  <div className="dash-projectRowBody">
                    {selectedProject.repository ? (
                      <div className="dash-projectDetailHeader">
                        <div className="dash-projectDetailContent">
                          <div className="dash-projectDetailTitle">
                            {selectedProject.repository.name}
                          </div>
                          <div
                            className="dash-truncateText dash-projectDetailPath"
                            title={selectedProject.repository.path}
                          >
                            {selectedProject.repository.path}
                          </div>
                          {selectedProject.repository.remoteUrl ? (
                            <div className="dash-projectRemote">
                              {selectedProject.repository.remoteProvider
                                ? `${selectedProject.repository.remoteProvider}: `
                                : ""}
                              {selectedProject.repository.remoteUrl}
                            </div>
                          ) : null}
                        </div>

                        <div className="dash-inlineActions">
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
                      <div className="dash-projectDetailEmpty">
                        <div className="dash-projectMetaText">
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
                      <div className="dash-projectMetaText dash-projectMetaTextSpaced">
                        {mappingMessage}
                      </div>
                    ) : null}
                  </div>
                </div>

                <div className="dash-worktreeCanvas">
                  <div className="dash-worktreeCanvasHeader">
                    <div>
                      <div className="dash-sideLabel">Worktree canvas</div>
                      <div className="dash-sideTitle">
                        Live work, sessions, and terminal links.
                      </div>
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
                          ? "Create task run and session"
                          : "Map a repository first"
                      }
                    >
                      New task / agent
                    </button>
                  </div>

                  <div className="dash-worktreeCanvasBody">
                    <section className="dash-worktreeCanvasPanel">
                      <div className="dash-worktreeCanvasPanelHeader">
                        <div>
                          <div className="dash-worktreeCanvasPanelTitle">
                            Work in project
                          </div>
                          <div className="dash-worktreeCanvasPanelMeta">
                            {fmtCount(selectedProjectVisibleWork.count)} active
                            item
                            {selectedProjectVisibleWork.count === 1 ? "" : "s"}
                          </div>
                        </div>
                        {selectedProjectVisibleWork.count > 0 ? (
                          <span className="dash-liveSessionProjectStatus">
                            {sessionScopeMode === "all"
                              ? "instances + runs"
                              : sessionScopeMode === "instances"
                                ? "instances"
                                : "runs"}
                          </span>
                        ) : null}
                      </div>

                      {selectedProjectVisibleWork.count > 0 ? (
                        <div className="dash-worktreeSessionGrid">
                          {selectedProjectVisibleWork.visibleInstances.map((instance) => {
                            const isOpen = openedInstanceSessions.has(instance.id);
                            const sessionId = openedInstanceSessions.get(instance.id);
                            return (
                              <button
                                key={instance.id}
                                type="button"
                                className={`dash-worktreeSessionChip dash-worktreeSessionChip--instance dash-worktreeSessionChip--interactive ${
                                  isOpen ? "is-active" : ""
                                }`}
                                onClick={() => {
                                  if (sessionId) {
                        setActiveTerminalSessionByInstanceWithDock(
                          instance.id,
                          sessionId,
                        );
                        return;
                      }
                                  void handleOpenTerminal(instance.id);
                                }}
                                disabled={terminalBusy}
                              >
                                <span
                                  className={`dash-sessionDot ${getSessionDotStateClass(
                                    instance.status,
                                  )}`}
                                />
                                <span className="dash-worktreeSessionChipBody">
                                  <span className="dash-worktreeSessionPrimary">
                                    {instance.branch ?? instance.agentType}
                                  </span>
                                  <span className="dash-worktreeSessionSubline">
                                    {instance.worktreePath ?? instance.id}
                                  </span>
                                </span>
                                <span className="dash-sessionAction">
                                  {terminalBusy &&
                                  activeTerminalInstanceId === instance.id
                                    ? "Opening..."
                                    : isOpen
                                      ? "Resume"
                                      : "Open"}
                                </span>
                              </button>
                            );
                          })}
                          {selectedProjectVisibleWork.visibleRuns.map((run) => {
                            const focused = isMatchingTask(
                              run.kanbangerIssueIdentifier,
                              taskFocusId,
                            )
                              ? true
                              : isMatchingTask(run.kanbangerIssueId, taskFocusId);
                            return (
                              <div
                                key={run.id}
                                className={`dash-worktreeSessionChip dash-worktreeSessionChip--run ${
                                  focused ? "is-focused" : ""
                                }`}
                              >
                                <span
                                  className={`dash-sessionDot ${getSessionDotStateClass(
                                    run.status,
                                  )}`}
                                />
                                <span className="dash-worktreeSessionChipBody">
                                  <span className="dash-worktreeSessionPrimary">
                                    {run.kanbangerIssueIdentifier}
                                  </span>
                                  {run.branch ? (
                                    <span className="dash-worktreeSessionSubline">
                                      {run.branch}
                                    </span>
                                  ) : null}
                                  {run.blockedReason ? (
                                    <span className="dash-worktreeSessionSubline is-warning">
                                      {run.blockedReason}
                                    </span>
                                  ) : null}
                                </span>
                                <span className="dash-sessionAction">{run.status}</span>
                              </div>
                            );
                          })}
                        </div>
                      ) : null}
                      {selectedProjectVisibleWork.count === 0 ? (
                        <div className="dash-worktreeSessionEmpty">
                          No active work for this project scope.
                          {taskFocusId ? (
                            <>
                              <br />
                              Focused task is not in the active scope.
                            </>
                          ) : null}
                        </div>
                      ) : null}

                          {lastCreated?.instanceId ? (
                            <div className="dash-worktreeCanvasSection">
                          <div className="dash-worktreeCanvasSectionTitle">
                            Last started worktree
                          </div>
                          {(() => {
                            const isOpen = openedInstanceSessions.has(
                              lastCreated.instanceId,
                            );
                            const sessionId = openedInstanceSessions.get(
                              lastCreated.instanceId,
                            );
                            return (
                              <button
                                type="button"
                                className={`dash-worktreeSessionChip dash-worktreeSessionChip--interactive ${
                                  isOpen ? "is-active" : ""
                                }`}
                                onClick={() => {
                                  if (sessionId) {
                                  setActiveTerminalSessionByInstanceWithDock(
                                    lastCreated.instanceId,
                                    sessionId,
                                  );
                                  return;
                                }
                                  void handleOpenTerminal(lastCreated.instanceId);
                                }}
                                disabled={terminalBusy}
                              >
                                <span
                                  className={`dash-sessionDot ${getSessionDotStateClass(
                                    lastCreated.instanceStatus,
                                  )}`}
                                />
                                <span className="dash-worktreeSessionChipBody">
                                  <span className="dash-worktreeSessionPrimary">
                                    Started instance
                                  </span>
                                  {lastCreated.taskIdentifier ? (
                                    <span className="dash-worktreeSessionSubline">
                                      Task {lastCreated.taskIdentifier}
                                    </span>
                                  ) : null}
                                  <span className="dash-worktreeSessionSubline">
                                    {lastCreated.worktreePath}
                                  </span>
                                </span>
                                <span className="dash-sessionAction">
                                  {terminalBusy &&
                                  activeTerminalInstanceId ===
                                    lastCreated.instanceId
                                    ? "Opening..."
                                    : isOpen
                                      ? "Resume"
                                      : "Open"}
                                </span>
                              </button>
                            );
                          })()}
                        </div>
                      ) : null}
                    </section>

                    <section className="dash-worktreeCanvasPanel">
                      <div className="dash-worktreeCanvasPanelHeader">
                        <div>
                          <div className="dash-worktreeCanvasPanelTitle">
                            Open terminal sessions
                          </div>
                          <div className="dash-worktreeCanvasPanelMeta">
                            {fmtCount(selectedProjectTerminalSessions.length)} session
                            {selectedProjectTerminalSessions.length === 1 ? "" : "s"}
                          </div>
                        </div>
                      </div>

                      {selectedProjectTerminalSessions.length > 0 ? (
                        <>
                          <div className="dash-worktreeCanvasSection dash-sessionFocusSection">
                            <div className="dash-worktreeCanvasSectionTitle">
                              Active session focus
                            </div>
                            {selectedProjectActiveTerminalSession ? (
                              <div className="dash-liveSessionChip dash-sessionFocusChip is-static is-active">
                                <span
                                  className={`dash-sessionDot ${getSessionDotStateClass(
                                    selectedProjectActiveTerminalSession.status,
                                  )}`}
                                />
                                <span className="dash-liveSessionChipInfo">
                                  <span>{selectedProjectActiveTerminalSession.label}</span>
                                  <span className="dash-terminalSessionSubline">
                                    {selectedProjectActiveTerminalSession.projectLabel} ·{" "}
                                    {getSessionPriorityLabel(
                                      selectedProjectActiveTerminalSession.status,
                                    )}
                                  </span>
                                </span>
                                <span className="dash-sessionAction">active</span>
                              </div>
                            ) : (
                              <div className="dash-worktreeSessionEmpty">
                                No active terminal selected in this project.
                              </div>
                            )}
                            {selectedProjectTerminalSessions.length > 1 ? (
                              <div className="dash-inlineActions dash-sessionFocusActions">
                                <button
                                  type="button"
                                  className="nav-button"
                                  onClick={() => cycleSelectedProjectTerminalSession(-1)}
                                >
                                  Prev session
                                </button>
                                <button
                                  type="button"
                                  className="nav-button"
                                  onClick={() => cycleSelectedProjectTerminalSession(1)}
                                >
                                  Next session
                                </button>
                              </div>
                            ) : null}
                            <div className="dash-projectMetaText dash-sessionFocusHint">
                              Shortcuts: Ctrl/Cmd + ←/→ (scope), Alt + ↑/↓ (project), 1-9
                              (scope index)
                            </div>
                          </div>
                          {renderConsoleSessionStrip(
                            selectedProjectTerminalSessions,
                            "Project session rail",
                            "dash-consoleSessionStrip--panel",
                          )}
                        </>
                      ) : (
                        <div className="dash-worktreeSessionEmpty">
                          No terminal sessions open for this project.
                        </div>
                      )}
                    </section>
                  </div>
                </div>

                <div className="dash-statGrid">
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

              </div>
            ) : (
              <div className="dash-stackGap14">
                {mappingErrors.length ? (
                  <div className="dash-alertCard">
                    <div className="dash-alertCardTitle">
                      Project mapping mismatches
                    </div>
                    <div className="dash-alertList">
                      {mappingErrors.slice(0, 6).map((e) => (
                        <div className="dash-alertItem" key={e.key}>
                          <strong className="dash-alertItemKey">{e.key}</strong>
                          {" · "}
                          <span className="dash-alertItemError">{e.name}</span>
                          <span className="dash-alertItemError">{e.error}</span>
                        </div>
                      ))}
                      {mappingErrors.length > 6 ? (
                        <div className="dash-alertItemMore">
                          +{fmtCount(mappingErrors.length - 6)} more
                        </div>
                      ) : null}
                    </div>
                  </div>
                ) : null}

                <div className="dash-worktreeCanvas">
                  <div className="dash-worktreeCanvasHeader">
                    <div>
                      <div className="dash-sideLabel">Workspace summary</div>
                      <div className="dash-sideTitle">
                        Select a project to inspect worktrees and active consoles.
                      </div>
                    </div>
                  </div>

                  <div className="dash-worktreeCanvasBody">
                    <section className="dash-worktreeCanvasPanel">
                      <div className="dash-worktreeCanvasPanelHeader">
                        <div>
                          <div className="dash-worktreeCanvasPanelTitle">
                            Projects with active work
                          </div>
                          <div className="dash-worktreeCanvasPanelMeta">
                            {fmtCount(allWorkByProject.length)} project
                            {allWorkByProject.length === 1 ? "" : "s"} active
                          </div>
                        </div>
                      </div>

                      {allWorkByProject.length > 0 ? (
                        <div className="dash-projectNavList">
                          {allWorkByProject.map((group) => {
                            const openTerminalCount =
                              terminalSessionProjectGroups.find(
                                (terminalGroup) =>
                                  terminalGroup.projectId === group.projectId,
                              )?.sessions.length ?? 0;
                            const totalWorkCount =
                              group.instances.length + group.runs.length;
                            const mappedProjectId =
                              group.projectId !== UNMAPPED_PROJECT_ID
                                ? group.projectId
                                : null;
                            const isFocusedGroup =
                              sessionProjectFilter === group.projectId ||
                              (mappedProjectId !== null &&
                                selectedProjectId === mappedProjectId);

                            return (
                              <button
                                key={group.projectId}
                                type="button"
                                className={`dash-projectNavButton ${
                                  isFocusedGroup ? "is-active" : ""
                                }`}
                                onClick={() => {
                                  setSessionProjectFilter(group.projectId);
                                  if (mappedProjectId) {
                                    setSelectedProjectId(mappedProjectId);
                                    updateUrlWithSelection("project", mappedProjectId);
                                    return;
                                  }
                                  setSelectedProjectId(null);
                                  updateUrlWithSelection("project", null);
                                }}
                              >
                                <span
                                  className="dash-projectChipDot"
                                  style={projectDotStyle(group.projectColor, group.mapped)}
                                />
                                <span>
                                  <span className="dash-projectKey">{group.projectKey}</span>
                                  <span className="dash-projectSubtitle">
                                    {fmtCount(group.instances.length)} instances •{" "}
                                    {fmtCount(group.runs.length)} runs
                                  </span>
                                  <span className="dash-projectSubtitle">
                                    {fmtCount(openTerminalCount)} open terminal
                                    session
                                    {openTerminalCount === 1 ? "" : "s"}
                                  </span>
                                </span>
                                <span className="dash-projectCount">
                                  {fmtCount(totalWorkCount)}
                                </span>
                                <span
                                  className={`dash-projectStatus ${
                                    group.mapped ? "is-mapped" : "is-error"
                                  }`}
                                >
                                  {group.mapped ? "mapped" : "unmapped"}
                                </span>
                              </button>
                            );
                          })}
                        </div>
                      ) : (
                        <div className="dash-worktreeSessionEmpty">
                          No active work in the current workspace.
                        </div>
                      )}
                    </section>

                    <section className="dash-worktreeCanvasPanel">
                      <div className="dash-worktreeCanvasPanelHeader">
                        <div>
                          <div className="dash-worktreeCanvasPanelTitle">
                            Open terminal sessions
                          </div>
                          <div className="dash-worktreeCanvasPanelMeta">
                            Grouped by project
                          </div>
                        </div>
                      </div>

                      {terminalSessionProjectGroups.length > 0 ? (
                        renderTerminalSessionGroups(terminalSessionProjectGroups)
                      ) : (
                        <div className="dash-worktreeSessionEmpty">
                          No terminal sessions open yet.
                        </div>
                      )}
                    </section>
                  </div>
                </div>
              </div>
            )}
            {showInlineConsole ? consolePanel("inline") : null}
          </div>
        </main>
      </div>

      {!showInlineConsole && activeTerminalSessionId ? consolePanel("floating") : null}

      {error && <div className="error-toast">{error}</div>}

      {repoPickerOpen ? (
        <div
          role="dialog"
          aria-modal="true"
          className="dash-modalBackdrop"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setRepoPickerOpen(false);
          }}
        >
          <div className="dash-modalSheet dash-modalSheetRepo">
            <div className="dash-modalHeader">
              <div>
                <div className="dash-modalLabel">
                  Map Project To Repo
                </div>
                <div className="dash-modalTitle">
                  {selectedProject
                    ? `${selectedProject.project.key} · ${selectedProject.project.name}`
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

            <div className="dash-modalToolbar">
              <input
                value={repoSearch}
                onChange={(e) => setRepoSearch(e.target.value)}
                placeholder="Search repos (owner/name)"
                className="dash-modalInput"
              />
              <div className="dash-modalMeta">
                {repoOptions?.repos?.length
                  ? `${fmtCount(repoOptions.repos.length)} repos`
                  : ""}
              </div>
            </div>

            <div className="dash-modalScrollable">
              {repoOptionsLoading ? (
                <div className="dash-modalStateText dash-modalStateTextMuted">
                  Loading repositories...
                </div>
              ) : repoOptionsError ? (
                <div className="dash-modalStateText dash-modalStateTextDanger">
                  {repoOptionsError}
                </div>
              ) : repoOptions && repoOptions.connections.length === 0 ? (
                <div className="dash-modalStateText">
                  No Git providers connected. Go to{" "}
                  <a href="/settings">Settings</a> to connect GitHub (OAuth) or
                  Gitea (PAT).
                </div>
              ) : repoCandidates.length === 0 ? (
                <div className="dash-modalStateText dash-modalStateTextMuted">
                  No matches.
                </div>
              ) : (
                <div className="dash-modalList">
                  {repoCandidates.slice(0, 200).map((r) => {
                    const isSelected = r.fullName === pendingRepoFullName;
                    const hasGitea = Boolean(r.sources.gitea);
                    const hasGitHub = Boolean(r.sources.github);
                    return (
                      <button
                        key={r.fullName}
                        type="button"
                        className={`dash-repoResult ${isSelected ? "is-selected" : ""}`}
                        onClick={() => {
                          setPendingRepoFullName(r.fullName);
                          setPendingRepoProvider(r.preferred.provider);
                        }}
                      >
                        <div className="dash-repoMeta">
                          <div className="dash-repoTitle">
                            {r.fullName}
                          </div>
                          <div className="dash-repoSubtitle">
                            {r.preferred.isPrivate ? "private" : "public"}{" "}
                            default: {r.preferred.defaultBranch}
                          </div>
                        </div>

                        <div className="dash-repoSourceBadges">
                          {hasGitea ? (
                            <span className="dash-repoProviderTag">
                              gitea
                            </span>
                          ) : null}
                          {hasGitHub ? (
                            <span className="dash-repoProviderTag">
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

            <div className="dash-modalFooter">
              <div className="dash-modalFooterGroup">
                <span className="dash-modalFooterLabel">
                  Provider
                </span>
                <button
                  type="button"
                  onClick={() => setPendingRepoProvider("gitea")}
                  disabled={!availableProvidersForPending.includes("gitea")}
                  className={`dash-providerButton nav-button ${
                    !availableProvidersForPending.includes("gitea")
                      ? "is-disabled"
                      : ""
                  } ${pendingRepoProvider === "gitea" ? "is-selected" : ""}`}
                >
                  Gitea
                </button>
                <button
                  type="button"
                  onClick={() => setPendingRepoProvider("github")}
                  disabled={!availableProvidersForPending.includes("github")}
                  className={`dash-providerButton nav-button ${
                    !availableProvidersForPending.includes("github")
                      ? "is-disabled"
                      : ""
                  } ${pendingRepoProvider === "github" ? "is-selected" : ""}`}
                >
                  GitHub
                </button>
              </div>

              <div className="dash-modalFooterGroup">
                {repoOptionsError ? (
                  <div className="dash-modalError">
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
          className="dash-modalBackdrop"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setStartSessionOpen(false);
          }}
        >
          <div className="dash-modalSheet dash-modalSheetSession">
            <div className="dash-modalHeader">
              <div>
                <div className="dash-modalLabel">
                  New Task / Agent Session
                </div>
                <div className="dash-modalTitle">
                  {selectedProject
                    ? `${selectedProject.project.key} · ${selectedProject.project.name}`
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

            <div className="dash-modalBody">
              <label className="dash-formLabel">
                Task identifier (optional)
              </label>
              <input
                value={taskIdentifier}
                onChange={(e) => setTaskIdentifier(e.target.value)}
                placeholder="PROJ-123"
                className="dash-formInput"
              />

              <label className="dash-formLabel">
                Branch name
              </label>
              <input
                value={newBranchName}
                onChange={(e) => setNewBranchName(e.target.value)}
                placeholder="feature/my-branch"
                className="dash-formInput"
              />

              <div className="dash-formGrid">
                <div>
                  <label className="dash-formLabel">
                    Base branch (optional)
                  </label>
                  <input
                    value={baseBranch}
                    onChange={(e) => setBaseBranch(e.target.value)}
                    placeholder="main"
                    className="dash-formInput"
                  />
                </div>

                <div>
                  <label className="dash-formLabel">
                    Agent
                  </label>
                  <select
                    value={agentType}
                    onChange={(e) => setAgentType(e.target.value as AgentType)}
                    className="dash-formInput"
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

            <div className="dash-modalFooter dash-modalFooterEnd">
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
