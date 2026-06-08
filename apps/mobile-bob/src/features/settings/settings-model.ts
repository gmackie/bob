export interface WorkspaceSettingMembership {
  workspace?: {
    id: string;
    name: string;
    slug: string;
  } | null;
}

export interface WorkspaceSettingRow {
  id: string;
  name: string;
  slug: string;
  isSelected: boolean;
}

export type MobileSettingsSectionKey =
  | "workspace"
  | "account"
  | "providers"
  | "app"
  | "device";

export interface MobileSettingsAction {
  key: "workspace" | "account" | "providers" | "app" | "device" | "logout";
  label: string;
  description: string;
  kind: "section" | "logout";
  targetSection?: MobileSettingsSectionKey;
}

export interface MobileSettingsProviderRow {
  key: "codex" | "cursor";
  label: "Codex" | "Cursor";
  description: string;
  href: "/providers/codex" | "/providers/cursor";
}

export interface MobileSettingsDeviceSummary {
  title: "Device";
  primaryLabel: string;
  detailLabel: string;
}

const MOBILE_SETTINGS_ACTIONS: MobileSettingsAction[] = [
  {
    key: "workspace",
    label: "Change Workspace",
    description: "Switch the workspace used by dashboards, queues, and projects.",
    kind: "section",
    targetSection: "workspace",
  },
  {
    key: "account",
    label: "Account Settings",
    description: "Manage the signed-in account and session on this device.",
    kind: "section",
    targetSection: "account",
  },
  {
    key: "providers",
    label: "Provider Settings",
    description: "Review Codex and Cursor monitoring entry points.",
    kind: "section",
    targetSection: "providers",
  },
  {
    key: "app",
    label: "App Settings",
    description: "Review appearance, notification, and mobile app preferences.",
    kind: "section",
    targetSection: "app",
  },
  {
    key: "device",
    label: "Device Settings",
    description: "Review device-specific auth, push, and API key surfaces.",
    kind: "section",
    targetSection: "device",
  },
  {
    key: "logout",
    label: "Log Out",
    description: "Sign out and clear the selected workspace on this device.",
    kind: "logout",
  },
];

const MOBILE_SETTINGS_PROVIDER_ROWS: MobileSettingsProviderRow[] = [
  {
    key: "codex",
    label: "Codex",
    description: "Open Codex usage, limits, active sessions, and recent outcomes.",
    href: "/providers/codex",
  },
  {
    key: "cursor",
    label: "Cursor",
    description: "Open Cursor usage, limits, active sessions, and recent outcomes.",
    href: "/providers/cursor",
  },
];

export function buildMobileSettingsActions(): MobileSettingsAction[] {
  return [...MOBILE_SETTINGS_ACTIONS];
}

export function buildMobileSettingsProviderRows(): MobileSettingsProviderRow[] {
  return [...MOBILE_SETTINGS_PROVIDER_ROWS];
}

export function buildMobileSettingsDeviceSummary(input: {
  apiKeyCount: number;
}): MobileSettingsDeviceSummary {
  return {
    title: "Device",
    primaryLabel: `${input.apiKeyCount} API key${input.apiKeyCount === 1 ? "" : "s"} configured`,
    detailLabel: "Device auth is tied to the current signed-in session.",
  };
}

export function buildWorkspaceSettingRows(input: {
  selectedWorkspaceId: string | null;
  memberships: WorkspaceSettingMembership[];
}): WorkspaceSettingRow[] {
  const workspaces = input.memberships
    .map((membership) => membership.workspace)
    .filter((workspace): workspace is NonNullable<WorkspaceSettingMembership["workspace"]> =>
      Boolean(workspace),
    );
  const selectedId = workspaces.some((workspace) => workspace.id === input.selectedWorkspaceId)
    ? input.selectedWorkspaceId
    : workspaces[0]?.id;

  return workspaces.map((workspace) => ({
    id: workspace.id,
    name: workspace.name,
    slug: workspace.slug,
    isSelected: workspace.id === selectedId,
  }));
}
