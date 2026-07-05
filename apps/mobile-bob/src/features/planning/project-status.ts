export interface MobileProjectStatusEntry {
  project: {
    id: string;
    name: string;
    key: string;
    status?: string | null;
    workspaceId?: string | null;
    planningProvider?: string | null;
    linearProjectId?: string | null;
    automationSettings?: Record<string, unknown> | null;
    updatedAt?: string | Date | null;
  };
  counts?: {
    active?: number;
    issues?: number;
    tasks?: number;
  } | null;
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
}

export interface MobileProjectStatusRow {
  id: string;
  title: string;
  name: string;
  key: string;
  projectStatus: string;
  workspaceId: string;
  planningProvider: string;
  linearProjectId: string | null;
  automationSettings: Record<string, unknown> | null;
  workspaceName: string;
  directory: string;
  repository: string;
  gitStatus: "Clean" | "Dirty" | "Stale" | "Missing repo" | "Auth issue" | "Invalid directory";
  branchLabel: string;
  buildSystem: string;
  linearStatus: "Connected" | "Not connected";
  configStatus: "Configured" | "Needs setup";
  activityLabel: string;
  warningLabel: string;
  warnings: string[];
}

export type MobileProjectRailStatusTone = "success" | "warning" | "default";

export interface MobileProjectRailRow {
  id: string;
  title: string;
  statusLabel: string;
  statusTone: MobileProjectRailStatusTone;
  detailLabel: string;
  activityLabel: string;
  lastUpdatedLabel: string;
  accessibilityLabel: string;
}

export interface MobileProjectsDashboardHeaderModel {
  title: "Projects";
  subtitle: string | null;
}

export type MobileProjectStatusFilter = "setup-issues" | "stale-sync" | "healthy";

export type MobileProjectDashboardColumnKey =
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

export interface MobileProjectDashboardColumn {
  key: MobileProjectDashboardColumnKey;
  label: string;
  flex: number;
  minWidth: number;
}

export interface MobileProjectConfigurationItem {
  label: string;
  value: string;
}

export interface MobileProjectConfigurationSection {
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
  status: "ready" | "warning" | "missing";
  items: MobileProjectConfigurationItem[];
}

export interface MobileProjectConfigurationManagementAction {
  key:
    | "review-identity"
    | "map-repository"
    | "connect-linear"
    | "edit-automation"
    | "review-env"
    | "review-checks";
  label: string;
}

export interface MobileProjectConfigurationManagementGroup {
  key: "identity" | "repository-integrations" | "planning-execution" | "validation";
  title: string;
  description: string;
  actions: MobileProjectConfigurationManagementAction[];
  sections: MobileProjectConfigurationSection[];
}

export type MobileProjectAutomationKey =
  | "autoDispatch"
  | "autoBranch"
  | "autoFeaturePR"
  | "ciTrigger";

export interface MobileProjectAutomationControl {
  key: MobileProjectAutomationKey;
  label: string;
  description: string;
  enabled: boolean;
}

const MOBILE_PROJECT_AUTOMATION_CONTROL_DEFS: {
  key: MobileProjectAutomationKey;
  label: string;
  description: string;
}[] = [
  {
    key: "autoDispatch",
    label: "Auto dispatch",
    description: "Start queued task work automatically when Bob can run it.",
  },
  {
    key: "autoBranch",
    label: "Auto branch",
    description: "Create execution branches for new task runs.",
  },
  {
    key: "autoFeaturePR",
    label: "Feature PR",
    description: "Open a pull request when implementation work is ready.",
  },
  {
    key: "ciTrigger",
    label: "CI trigger",
    description: "Run configured validation after agent changes.",
  },
];

const MOBILE_PROJECT_DASHBOARD_COLUMNS: MobileProjectDashboardColumn[] = [
  { key: "project", label: "Project", flex: 1.4, minWidth: 170 },
  { key: "workspace", label: "Workspace", flex: 1, minWidth: 130 },
  { key: "directory", label: "Directory", flex: 1.2, minWidth: 150 },
  { key: "repository", label: "Repository", flex: 1.1, minWidth: 140 },
  { key: "branch", label: "Branch", flex: 1, minWidth: 130 },
  { key: "build", label: "Build", flex: 0.75, minWidth: 88 },
  { key: "git", label: "Git", flex: 0.75, minWidth: 88 },
  { key: "linear", label: "Linear", flex: 0.9, minWidth: 110 },
  { key: "config", label: "Config", flex: 0.9, minWidth: 110 },
  { key: "warnings", label: "Warnings", flex: 1.3, minWidth: 170 },
];

export function getMobileProjectDashboardColumns(): MobileProjectDashboardColumn[] {
  return MOBILE_PROJECT_DASHBOARD_COLUMNS.map((column) => ({ ...column }));
}

export function getMobileProjectQueryRefreshOptions(): {
  refetchInterval: number;
} {
  return {
    refetchInterval: 15_000,
  };
}

export function getMobileProjectsDashboardHeaderModel(): MobileProjectsDashboardHeaderModel {
  return {
    title: "Projects",
    subtitle: null,
  };
}

export function buildMobileProjectStatusRows(input: {
  workspaceName?: string | null;
  projects: MobileProjectStatusEntry[];
}): MobileProjectStatusRow[] {
  const workspaceName = input.workspaceName?.trim() ?? "Current workspace";

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
      title: `${entry.project.key} · ${entry.project.name}`,
      name: entry.project.name,
      key: entry.project.key,
      projectStatus: entry.project.status ?? "unknown",
      workspaceId: entry.project.workspaceId ?? "Unknown",
      planningProvider: entry.project.planningProvider ?? "Not configured",
      linearProjectId: entry.project.linearProjectId ?? null,
      automationSettings: entry.project.automationSettings ?? null,
      workspaceName,
      directory: repository?.path ?? "Not mapped",
      repository: formatRepository(repository),
      gitStatus: repositoryHealth.gitStatus,
      branchLabel: formatBranchLabel(repository),
      buildSystem: formatBuildSystem(repository),
      linearStatus: hasLinearLink ? "Connected" : "Not connected",
      configStatus: hasRepository && hasAutomationConfig ? "Configured" : "Needs setup",
      activityLabel: `${entry.counts?.tasks ?? 0} tasks · ${entry.counts?.issues ?? 0} issues · ${entry.counts?.active ?? 0} active`,
      warningLabel: warnings.length > 0 ? warnings.join(", ") : "Ready",
      warnings,
    };
  });
}

export function buildMobileProjectRailRows(input: {
  workspaceName?: string | null;
  projects: MobileProjectStatusEntry[];
  now?: Date;
}): MobileProjectRailRow[] {
  const now = input.now ?? new Date();
  const statusRows = buildMobileProjectStatusRows({
    workspaceName: input.workspaceName,
    projects: input.projects,
  });

  return statusRows.map((row, index) => {
    const project = input.projects[index]?.project;
    const statusLabel = row.configStatus;
    const lastUpdatedLabel = formatLastUpdatedLabel(project?.updatedAt, now);

    return {
      id: row.id,
      title: row.title,
      statusLabel,
      statusTone: statusLabel === "Configured" ? "success" : "warning",
      detailLabel: row.warningLabel,
      activityLabel: row.activityLabel,
      lastUpdatedLabel,
      accessibilityLabel: `${row.title}, ${statusLabel}, updated ${lastUpdatedLabel}`,
    };
  });
}

export function normalizeMobileProjectStatusFilter(
  value: string | null | undefined,
): MobileProjectStatusFilter | null {
  return value === "setup-issues" || value === "stale-sync" || value === "healthy"
    ? value
    : null;
}

export function filterMobileProjectStatusRows(
  rows: MobileProjectStatusRow[],
  filter: string | null | undefined,
): MobileProjectStatusRow[] {
  const normalized = normalizeMobileProjectStatusFilter(filter ?? null);
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

export function buildMobileProjectConfigurationSections(
  row: MobileProjectStatusRow,
): MobileProjectConfigurationSection[] {
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
      title: "Workspace",
      status: row.workspaceId === "Unknown" ? "warning" : "ready",
      items: [
        { label: "Workspace", value: row.workspaceName },
        { label: "Workspace ID", value: row.workspaceId },
      ],
    },
    {
      key: "directory",
      title: "Directory",
      status: row.directory === "Not mapped" ? "missing" : "ready",
      items: [
        { label: "Root path", value: row.directory },
        { label: "Build system", value: row.buildSystem },
      ],
    },
    {
      key: "git",
      title: "Git",
      status: row.gitStatus === "Clean" ? "ready" : "warning",
      items: [
        { label: "Repository", value: row.repository },
        { label: "Branch", value: row.branchLabel },
        { label: "Git status", value: row.gitStatus },
      ],
    },
    {
      key: "linear",
      title: "Linear",
      status: row.linearStatus === "Connected" ? "ready" : "missing",
      items: [
        { label: "Provider", value: row.planningProvider },
        { label: "Linear project", value: row.linearProjectId ?? "Not connected" },
      ],
    },
    {
      key: "planning",
      title: "Planning",
      status: planningDefaults.length > 0 ? "ready" : "missing",
      items: planningDefaults.length > 0
        ? planningDefaults
        : [{ label: "Defaults", value: "Not configured" }],
    },
    {
      key: "execution",
      title: "Execution",
      status: executionSettings.length > 0 ? "ready" : "missing",
      items: executionSettings.length > 0
        ? executionSettings
        : [{ label: "Execution", value: "Not configured" }],
    },
    {
      key: "secrets",
      title: "Secrets",
      status: envReferences.length > 0 ? "ready" : "missing",
      items: envReferences.length > 0
        ? envReferences
        : [{ label: "References", value: "No references configured" }],
    },
    {
      key: "validation",
      title: "Validation",
      status: row.warningLabel === "Ready" ? "ready" : "warning",
      items: [
        { label: "Bob config", value: row.configStatus },
        { label: "Warnings", value: row.warningLabel },
      ],
    },
  ];
}

export function buildMobileProjectConfigurationManagementGroups(
  sections: MobileProjectConfigurationSection[],
): MobileProjectConfigurationManagementGroup[] {
  const byKey = new Map(sections.map((section) => [section.key, section]));
  const pick = (keys: MobileProjectConfigurationSection["key"][]) =>
    keys.flatMap((key) => {
      const section = byKey.get(key);
      return section ? [section] : [];
    });

  return [
    {
      key: "identity",
      title: "Project Identity",
      description: "Bob metadata and workspace assignment for this project.",
      actions: [{ key: "review-identity", label: "Review project identity" }],
      sections: pick(["metadata", "workspace"]),
    },
    {
      key: "repository-integrations",
      title: "Repository & Integrations",
      description: "Local directory, git repository, branch, and Linear mapping.",
      actions: [
        { key: "map-repository", label: "Map repository" },
        { key: "connect-linear", label: "Connect Linear" },
      ],
      sections: pick(["directory", "git", "linear"]),
    },
    {
      key: "planning-execution",
      title: "Planning & Execution",
      description: "Project planning defaults, execution settings, and secret references.",
      actions: [
        { key: "edit-automation", label: "Edit automation" },
        { key: "review-env", label: "Review env references" },
      ],
      sections: pick(["planning", "execution", "secrets"]),
    },
    {
      key: "validation",
      title: "Validation",
      description: "Configuration checks and setup warnings before Bob runs work.",
      actions: [{ key: "review-checks", label: "Review checks" }],
      sections: pick(["validation"]),
    },
  ];
}

export function buildMobileProjectAutomationControls(
  settings: Record<string, unknown> | null,
): MobileProjectAutomationControl[] {
  return MOBILE_PROJECT_AUTOMATION_CONTROL_DEFS.map((control) => ({
    ...control,
    enabled: getBoolean(settings?.[control.key]) ?? false,
  }));
}

function formatBuildSystem(repository: MobileProjectStatusEntry["linkedRepository"]): string {
  const buildSystem = repository?.buildSystem?.trim();
  return buildSystem && buildSystem.length > 0 ? buildSystem : "Unknown";
}

function formatGitStatus(repository: MobileProjectStatusEntry["linkedRepository"]): MobileProjectStatusRow["gitStatus"] {
  if (!repository) return "Missing repo";
  const discoveryStatus = repository.discoveryStatus?.trim().toLowerCase();
  if (discoveryStatus?.includes("auth")) return "Auth issue";
  if (discoveryStatus?.includes("invalid")) return "Invalid directory";
  if (repository.dirty) return "Dirty";
  if (repository.stale) return "Stale";
  return "Clean";
}

function getRepositoryHealth(repository: MobileProjectStatusEntry["linkedRepository"]): {
  gitStatus: MobileProjectStatusRow["gitStatus"];
  warning: string | null;
} {
  const gitStatus = formatGitStatus(repository);
  if (gitStatus === "Auth issue" || gitStatus === "Invalid directory") {
    return { gitStatus, warning: gitStatus };
  }
  return { gitStatus, warning: null };
}

function formatBranchLabel(repository: MobileProjectStatusEntry["linkedRepository"]): string {
  const branch = repository?.branch?.trim();
  const mainBranch = repository?.mainBranch?.trim();

  if (!branch) return "No branch";
  if (!mainBranch || branch === mainBranch) return branch;
  return `${branch} (default ${mainBranch})`;
}

function formatRepository(repository: MobileProjectStatusEntry["linkedRepository"]): string {
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

function hasConfiguredAutomation(settings: MobileProjectStatusEntry["project"]["automationSettings"]) {
  if (!settings) return false;

  return Object.values(settings).some((value) => {
    if (Array.isArray(value)) return value.length > 0;
    if (value && typeof value === "object") return Object.keys(value).length > 0;
    return Boolean(value);
  });
}

function getPlanningDefaults(
  settings: Record<string, unknown> | null,
): MobileProjectConfigurationItem[] {
  const planning = getRecord(settings?.planning);
  const defaultAgent = getString(planning?.defaultAgent ?? settings?.defaultAgent);
  const planningMode = getString(planning?.mode ?? settings?.planningMode);

  return [
    defaultAgent ? { label: "Default agent", value: defaultAgent } : null,
    planningMode ? { label: "Planning mode", value: planningMode } : null,
  ].filter((item): item is MobileProjectConfigurationItem => Boolean(item));
}

function getExecutionSettings(
  settings: Record<string, unknown> | null,
): MobileProjectConfigurationItem[] {
  if (!settings) return [];

  const execution = getRecord(settings.execution);
  const provider = getString(execution?.provider ?? settings.executionProvider);
  const autoDispatch = getBoolean(settings.autoDispatch);

  return [
    autoDispatch === null
      ? null
      : { label: "Auto dispatch", value: autoDispatch ? "Enabled" : "Disabled" },
    provider ? { label: "Provider", value: provider } : null,
  ].filter((item): item is MobileProjectConfigurationItem => Boolean(item));
}

function getEnvReferences(
  settings: Record<string, unknown> | null,
): MobileProjectConfigurationItem[] {
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

function formatLastUpdatedLabel(
  value: string | Date | null | undefined,
  now: Date,
): string {
  if (!value) return "No activity";
  const timestamp = value instanceof Date ? value.getTime() : Date.parse(value);
  if (!Number.isFinite(timestamp)) return "No activity";

  const diffMs = Math.max(0, now.getTime() - timestamp);
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  return `${Math.floor(hours / 24)}d ago`;
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
