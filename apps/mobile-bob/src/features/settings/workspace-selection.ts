export const SELECTED_WORKSPACE_KEY = "@bob/selected_workspace";

export interface SelectableWorkspaceMembership {
  workspace?: {
    id: string;
    name: string;
    slug?: string | null;
  } | null;
}

export type SelectedWorkspace = NonNullable<SelectableWorkspaceMembership["workspace"]>;

export function selectWorkspace(input: {
  selectedWorkspaceId: string | null;
  routeWorkspaceId?: string | null;
  memberships: SelectableWorkspaceMembership[];
}): SelectedWorkspace | null {
  const workspaces = input.memberships
    .map((membership) => membership.workspace)
    .filter((workspace): workspace is SelectedWorkspace => Boolean(workspace));

  return (
    workspaces.find((workspace) => workspace.id === input.routeWorkspaceId) ??
    workspaces.find((workspace) => workspace.id === input.selectedWorkspaceId) ??
    workspaces[0] ??
    null
  );
}

export function buildWorkspaceSelectionPath(
  currentPath: string,
  workspaceId: string,
): string {
  const [pathname = "/", queryString = ""] = currentPath.split("?");
  const params = new URLSearchParams(queryString);
  params.set("workspace", workspaceId);
  const nextQuery = params.toString();
  return nextQuery ? `${pathname}?${nextQuery}` : pathname;
}
