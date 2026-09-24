import { getNotificationTargetHref } from "../planning/navigation";

export const SELECTED_WORKSPACE_KEY = "@bob/selected_workspace";

export interface SelectableWorkspaceMembership {
  workspace?: {
    id: string;
    name: string;
    slug?: string | null;
  } | null;
  /** Wire timestamp from the membership row; used only to pick a default. */
  joinedAt?: string | null;
}

export type SelectedWorkspace = NonNullable<
  SelectableWorkspaceMembership["workspace"]
>;

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
    workspaces.find(
      (workspace) => workspace.id === input.selectedWorkspaceId,
    ) ??
    defaultWorkspace(input.memberships) ??
    null
  );
}

/**
 * Which workspace a person lands on before they have ever chosen one.
 *
 * The list arrives ordered by `joinedAt` descending, so taking the first
 * element meant "most recently joined". A second workspace made later for a
 * side project therefore became the default, and a fresh install opened on an
 * empty workspace with no daemon: "No host connected" over "All clear", which
 * reads as a broken app rather than the wrong workspace.
 *
 * The oldest membership is the better guess at someone's main workspace, and
 * it is stable — it does not move when a new workspace is created.
 */
function defaultWorkspace(
  memberships: SelectableWorkspaceMembership[],
): SelectedWorkspace | undefined {
  const dated = memberships.filter(
    (membership): membership is SelectableWorkspaceMembership & { joinedAt: string } =>
      Boolean(membership.workspace) && typeof membership.joinedAt === "string",
  );
  const oldest = dated.reduce<(typeof dated)[number] | undefined>(
    (earliest, membership) =>
      !earliest || membership.joinedAt < earliest.joinedAt ? membership : earliest,
    undefined,
  );
  // Without timestamps there is nothing to order by, so keep the old
  // behaviour rather than inventing one.
  return (
    oldest?.workspace ??
    memberships.find((membership) => membership.workspace)?.workspace ??
    undefined
  );
}

export function buildWorkspaceSelectionPath(
  currentPath: string,
  workspaceId: string,
) {
  const [pathname = "/", queryString = ""] = currentPath.split("?");
  const params = new URLSearchParams(queryString);
  params.set("workspace", workspaceId);
  const nextQuery = params.toString();
  return (
    getNotificationTargetHref({
      url: nextQuery ? `${pathname}?${nextQuery}` : pathname,
    }) ?? "/settings"
  );
}
