export type ProjectDetailTabKey = "board" | "list" | "requirements" | "settings";

const PROJECT_DETAIL_TABS = new Set<ProjectDetailTabKey>([
  "board",
  "list",
  "requirements",
  "settings",
]);

export function normalizeProjectDetailTab(value: string | null): ProjectDetailTabKey {
  return value && PROJECT_DETAIL_TABS.has(value as ProjectDetailTabKey)
    ? (value as ProjectDetailTabKey)
    : "board";
}

export function getProjectConfigurationHref(
  projectId: string,
  workspaceId?: string | null,
): string {
  const params = new URLSearchParams({ tab: "settings" });
  if (workspaceId) params.set("workspace", workspaceId);
  return `/projects/${projectId}?${params.toString()}#project-settings`;
}

export function getProjectsDashboardHref(workspaceId?: string | null): string {
  if (!workspaceId) return "/planning/projects";
  const params = new URLSearchParams({ workspace: workspaceId });
  return `/planning/projects?${params.toString()}`;
}

function appendWorkspaceParam(path: string, workspaceId?: string | null): string {
  if (!workspaceId) return path;
  const separator = path.includes("?") ? "&" : "?";
  return `${path}${separator}workspace=${encodeURIComponent(workspaceId)}`;
}

export function getProjectWorkItemHref(
  item: { id: string; kind: string; workspaceId?: string | null },
  workspaceId?: string | null,
): string {
  const path =
    item.kind === "task"
      ? `/work-items/${item.id}?view=queue`
      : `/work-items/${item.id}`;

  return appendWorkspaceParam(path, workspaceId ?? item.workspaceId);
}
