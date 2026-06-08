type ProjectStatusInput = {
  workspaceName?: string | null;
  projects: ProjectStatusEntry[];
};

export type ProjectStatusEntry = {
  project: {
    id: string;
    name: string;
    key: string;
    planningProvider?: string | null;
    linearProjectId?: string | null;
    automationSettings?: Record<string, unknown> | null;
    [key: string]: unknown;
  };
  linkedRepository?: {
    path?: string | null;
    branch?: string | null;
    mainBranch?: string | null;
    remoteProvider?: string | null;
    remoteOwner?: string | null;
    remoteName?: string | null;
    remoteUrl?: string | null;
    buildSystem?: string | null;
    dirty?: boolean | null;
    stale?: boolean | null;
    discoveryStatus?: string | null;
  } | null;
};

export type ProjectStatusRow = {
  id: string;
  name: string;
  key: string;
  projectStatus: string;
  planningProvider: string;
  linearProjectId: string | null;
  automationSettings: Record<string, unknown> | null;
  workspaceName: string;
  workspaceId: string;
  directory: string;
  repository: string;
  gitStatus: "Clean" | "Dirty" | "Stale" | "Missing repo" | "Auth issue" | "Invalid directory";
  branchLabel: string;
  buildSystem: string;
  linearStatus: "Connected" | "Not connected";
  configStatus: "Configured" | "Needs setup";
  warnings: string[];
};

export type ProjectStatusFilter = "setup-issues" | "stale-sync" | "healthy";

export type ProjectStatusDashboardColumnKey =
  | "project"
  | "workspace"
  | "directory"
  | "repository"
  | "branch"
  | "build"
  | "git"
  | "linear"
  | "config"
  | "warnings";

export type ProjectStatusDashboardColumn = {
  key: ProjectStatusDashboardColumnKey;
  label: string;
};

export type ProjectConfigurationSectionStatus = "ready" | "warning" | "missing";

export type ProjectConfigurationItem = {
  label: string;
  value: string;
};

export type ProjectConfigurationSection = {
  key:
    | "metadata"
    | "workspace"
    | "directory"
    | "git"
    | "linear"
    | "planning"
    | "execution"
    | "secrets"
    | "validation";
  title: string;
  status: ProjectConfigurationSectionStatus;
  items: ProjectConfigurationItem[];
};

export type ProjectConfigurationManagementGroup = {
  key: "identity" | "repository-integrations" | "planning-execution" | "validation";
  title: string;
  description: string;
  actions: ProjectConfigurationManagementAction[];
  sections: ProjectConfigurationSection[];
};

export type ProjectConfigurationManagementAction = {
  key:
    | "review-identity"
    | "map-repository"
    | "connect-linear"
    | "edit-automation"
    | "review-env"
    | "review-checks";
  label: string;
  targetId: string;
};

const PROJECT_STATUS_DASHBOARD_COLUMNS: ProjectStatusDashboardColumn[] = [
  { key: "project", label: "Project" },
  { key: "workspace", label: "Workspace" },
  { key: "directory", label: "Directory" },
  { key: "repository", label: "Repository" },
  { key: "branch", label: "Branch" },
  { key: "build", label: "Build" },
  { key: "git", label: "Git" },
  { key: "linear", label: "Linear" },
  { key: "config", label: "Config" },
  { key: "warnings", label: "Warnings" },
];

export function getProjectStatusDashboardColumns(): ProjectStatusDashboardColumn[] {
  return PROJECT_STATUS_DASHBOARD_COLUMNS.map((column) => ({ ...column }));
}

export function buildProjectStatusRows(input: ProjectStatusInput): ProjectStatusRow[] {
  const workspaceName = input.workspaceName?.trim() || "Current workspace";

  return input.projects.map((entry) => {
    const repository = entry.linkedRepository;
    const hasRepository = Boolean(repository);
    const hasLinearLink =
      entry.project.planningProvider === "linear" && Boolean(entry.project.linearProjectId);
    const hasAutomationConfig = hasConfiguredAutomation(entry.project.automationSettings);
    const warnings: string[] = [];

    if (!hasRepository) warnings.push("Missing repository");
    if (!hasLinearLink) warnings.push("Missing Linear link");
    const repositoryHealth = getRepositoryHealth(repository);

    if (repositoryHealth.warning) warnings.push(repositoryHealth.warning);
    if (repository?.dirty) warnings.push("Dirty workspace");
    if (repository?.stale) warnings.push("Stale sync");

    return {
      id: entry.project.id,
      name: entry.project.name,
      key: entry.project.key,
      projectStatus: typeof entry.project.status === "string" ? entry.project.status : "unknown",
      planningProvider: entry.project.planningProvider ?? "Not configured",
      linearProjectId: entry.project.linearProjectId ?? null,
      automationSettings: entry.project.automationSettings ?? null,
      workspaceName,
      workspaceId: typeof entry.project.workspaceId === "string" ? entry.project.workspaceId : "Unknown",
      directory: repository?.path ?? "Not mapped",
      repository: formatRepository(repository),
      gitStatus: repositoryHealth.gitStatus,
      branchLabel: formatBranchLabel(repository),
      buildSystem: formatBuildSystem(repository),
      linearStatus: hasLinearLink ? "Connected" : "Not connected",
      configStatus: hasRepository && hasAutomationConfig ? "Configured" : "Needs setup",
      warnings,
    };
  });
}

export function normalizeProjectStatusFilter(
  value: string | null | undefined,
): ProjectStatusFilter | null {
  return value === "setup-issues" || value === "stale-sync" || value === "healthy"
    ? value
    : null;
}

export function filterProjectStatusRows(
  rows: ProjectStatusRow[],
  filter: ProjectStatusFilter | string | null | undefined,
): ProjectStatusRow[] {
  const normalized = normalizeProjectStatusFilter(filter ?? null);
  if (!normalized) return rows;

  if (normalized === "stale-sync") {
    return rows.filter((row) => row.warnings.includes("Stale sync"));
  }

  if (normalized === "healthy") {
    return rows.filter((row) => row.warnings.length === 0 && row.configStatus === "Configured");
  }

  return rows.filter((row) =>
    row.configStatus === "Needs setup" ||
    row.warnings.some((warning) => warning !== "Stale sync"),
  );
}

export function buildProjectConfigurationSections(
  row: ProjectStatusRow,
): ProjectConfigurationSection[] {
  const planningDefaults = getPlanningDefaults(row.automationSettings);
  const executionSettings = getExecutionSettings(row.automationSettings);
  const envReferences = getEnvReferences(row.automationSettings);

  return [
    {
      key: "metadata",
      title: "Bob Project",
      status: row.projectStatus === "unknown" ? "warning" : "ready",
      items: [
        { label: "Name", value: row.name },
        { label: "Key", value: row.key },
        { label: "Status", value: formatProjectValue(row.projectStatus) },
      ],
    },
    {
      key: "workspace",
      title: "Workspace Assignment",
      status: row.workspaceId === "Unknown" ? "warning" : "ready",
      items: [
        { label: "Workspace", value: row.workspaceName },
        { label: "Workspace ID", value: row.workspaceId },
      ],
    },
    {
      key: "directory",
      title: "Local Directory",
      status: row.directory === "Not mapped" ? "missing" : "ready",
      items: [
        { label: "Root path", value: row.directory },
        { label: "Build system", value: row.buildSystem },
      ],
    },
    {
      key: "git",
      title: "Git Repository",
      status: row.gitStatus === "Clean" ? "ready" : "warning",
      items: [
        { label: "Repository", value: row.repository },
        { label: "Branch", value: row.branchLabel },
        { label: "Git status", value: row.gitStatus },
      ],
    },
    {
      key: "linear",
      title: "Linear Mapping",
      status: row.linearStatus === "Connected" ? "ready" : "missing",
      items: [
        { label: "Provider", value: row.planningProvider },
        { label: "Linear project", value: row.linearProjectId ?? "Not connected" },
      ],
    },
    {
      key: "planning",
      title: "Planning Defaults",
      status: planningDefaults.length > 0 ? "ready" : "missing",
      items: planningDefaults.length > 0
        ? planningDefaults
        : [{ label: "Defaults", value: "Not configured" }],
    },
    {
      key: "execution",
      title: "Execution Settings",
      status: executionSettings.length > 0 ? "ready" : "missing",
      items: executionSettings.length > 0
        ? executionSettings
        : [{ label: "Execution", value: "Not configured" }],
    },
    {
      key: "secrets",
      title: "Secrets & Env",
      status: envReferences.length > 0 ? "ready" : "missing",
      items: envReferences.length > 0
        ? envReferences
        : [{ label: "References", value: "No references configured" }],
    },
    {
      key: "validation",
      title: "Validation Checks",
      status: row.warnings.length > 0 ? "warning" : "ready",
      items: [
        { label: "Bob config", value: row.configStatus },
        { label: "Warnings", value: row.warnings.length > 0 ? row.warnings.join(", ") : "Ready" },
      ],
    },
  ];
}

export function buildProjectConfigurationManagementGroups(
  sections: ProjectConfigurationSection[],
): ProjectConfigurationManagementGroup[] {
  const byKey = new Map(sections.map((section) => [section.key, section]));
  const pick = (keys: ProjectConfigurationSection["key"][]) =>
    keys.flatMap((key) => {
      const section = byKey.get(key);
      return section ? [section] : [];
    });

  return [
    {
      key: "identity",
      title: "Project Identity",
      description: "Bob metadata and workspace assignment for this project.",
      actions: [
        {
          key: "review-identity",
          label: "Review project identity",
          targetId: "project-settings",
        },
      ],
      sections: pick(["metadata", "workspace"]),
    },
    {
      key: "repository-integrations",
      title: "Repository & Integrations",
      description: "Local directory, git repository, branch, and Linear mapping.",
      actions: [
        {
          key: "map-repository",
          label: "Map repository",
          targetId: "repository-controls",
        },
        {
          key: "connect-linear",
          label: "Connect Linear",
          targetId: "project-settings",
        },
      ],
      sections: pick(["directory", "git", "linear"]),
    },
    {
      key: "planning-execution",
      title: "Planning & Execution",
      description: "Project planning defaults, execution settings, and secret references.",
      actions: [
        {
          key: "edit-automation",
          label: "Edit automation",
          targetId: "automation-settings",
        },
        {
          key: "review-env",
          label: "Review env references",
          targetId: "project-settings",
        },
      ],
      sections: pick(["planning", "execution", "secrets"]),
    },
    {
      key: "validation",
      title: "Validation",
      description: "Configuration checks and setup warnings before Bob runs work.",
      actions: [
        {
          key: "review-checks",
          label: "Review checks",
          targetId: "project-validation",
        },
      ],
      sections: pick(["validation"]),
    },
  ];
}

export function getProjectStatusRowHref(
  projectId: string,
  workspaceId?: string | null,
): string {
  const params = new URLSearchParams({ tab: "settings" });
  if (workspaceId) params.set("workspace", workspaceId);
  return `/projects/${projectId}?${params.toString()}#project-settings`;
}

function formatBuildSystem(repository: ProjectStatusEntry["linkedRepository"]): string {
  const buildSystem = repository?.buildSystem?.trim();
  return buildSystem && buildSystem.length > 0 ? buildSystem : "Unknown";
}

function formatGitStatus(repository: ProjectStatusEntry["linkedRepository"]): ProjectStatusRow["gitStatus"] {
  if (!repository) return "Missing repo";
  const discoveryStatus = repository.discoveryStatus?.trim().toLowerCase();
  if (discoveryStatus?.includes("auth")) return "Auth issue";
  if (discoveryStatus?.includes("invalid")) return "Invalid directory";
  if (repository.dirty) return "Dirty";
  if (repository.stale) return "Stale";
  return "Clean";
}

function getRepositoryHealth(repository: ProjectStatusEntry["linkedRepository"]): {
  gitStatus: ProjectStatusRow["gitStatus"];
  warning: string | null;
} {
  const gitStatus = formatGitStatus(repository);
  if (gitStatus === "Auth issue" || gitStatus === "Invalid directory") {
    return { gitStatus, warning: gitStatus };
  }
  return { gitStatus, warning: null };
}

function formatBranchLabel(repository: ProjectStatusEntry["linkedRepository"]): string {
  const branch = repository?.branch?.trim();
  const mainBranch = repository?.mainBranch?.trim();

  if (!branch) return "No branch";
  if (!mainBranch || branch === mainBranch) return branch;
  return `${branch} (default ${mainBranch})`;
}

function formatRepository(repository: ProjectStatusEntry["linkedRepository"]): string {
  if (!repository) return "No repository";

  const remoteParts = [
    repository.remoteProvider,
    repository.remoteOwner,
    repository.remoteName,
  ].filter(Boolean);

  if (remoteParts.length > 0) return remoteParts.join("/");
  if (repository.remoteUrl) return repository.remoteUrl;
  return "Repository linked";
}

function hasConfiguredAutomation(settings: ProjectStatusEntry["project"]["automationSettings"]): boolean {
  if (!settings) return false;

  return Object.values(settings).some((value) => {
    if (Array.isArray(value)) return value.length > 0;
    if (value && typeof value === "object") return Object.keys(value).length > 0;
    return Boolean(value);
  });
}

function getPlanningDefaults(
  settings: Record<string, unknown> | null,
): ProjectConfigurationItem[] {
  const planning = getRecord(settings?.planning);
  const defaultAgent = getString(planning?.defaultAgent ?? settings?.defaultAgent);
  const planningMode = getString(planning?.mode ?? settings?.planningMode);

  return [
    defaultAgent ? { label: "Default agent", value: defaultAgent } : null,
    planningMode ? { label: "Planning mode", value: planningMode } : null,
  ].filter((item): item is ProjectConfigurationItem => Boolean(item));
}

function getExecutionSettings(
  settings: Record<string, unknown> | null,
): ProjectConfigurationItem[] {
  if (!settings) return [];

  const execution = getRecord(settings.execution);
  const provider = getString(execution?.provider ?? settings.executionProvider);
  const autoDispatch = getBoolean(settings.autoDispatch);

  return [
    autoDispatch === null
      ? null
      : { label: "Auto dispatch", value: autoDispatch ? "Enabled" : "Disabled" },
    provider ? { label: "Provider", value: provider } : null,
  ].filter((item): item is ProjectConfigurationItem => Boolean(item));
}

function getEnvReferences(
  settings: Record<string, unknown> | null,
): ProjectConfigurationItem[] {
  const env = getRecord(settings?.env);
  const required = getStringList(env?.required ?? settings?.requiredEnv);

  return required.length > 0
    ? [{ label: "Required env", value: required.join(", ") }]
    : [];
}

function getRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function getString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function getBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function getStringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [];
}

function formatProjectValue(value: string): string {
  return value
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}
