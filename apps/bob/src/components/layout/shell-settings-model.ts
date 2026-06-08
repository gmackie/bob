export interface ShellWorkspace {
  id: string;
  name: string;
  slug?: string | null;
}

export interface ShellSettingsAction {
  key: string;
  label: string;
  href?: string;
  kind: "section" | "logout";
}

const SHELL_SETTINGS_ACTIONS: ShellSettingsAction[] = [
  { key: "workspace", label: "Change Workspace", kind: "section" },
  { key: "account", label: "Account Settings", href: "/settings?section=preferences", kind: "section" },
  { key: "providers", label: "Provider Settings", href: "/settings?section=git-providers", kind: "section" },
  { key: "app", label: "App Settings", href: "/settings?section=preferences", kind: "section" },
  { key: "device", label: "Device Settings", href: "/settings?section=cookie-jar", kind: "section" },
  { key: "logout", label: "Log Out", kind: "logout" },
];

function appendWorkspaceParam(href: string, workspaceId?: string | null): string {
  if (!workspaceId) return href;

  const [pathname = href, queryString = ""] = href.split("?");
  const params = new URLSearchParams(queryString);
  params.set("workspace", workspaceId);
  const nextQuery = params.toString();

  return nextQuery ? `${pathname}?${nextQuery}` : pathname;
}

export function buildShellSettingsActions(
  workspaceId?: string | null,
): ShellSettingsAction[] {
  return SHELL_SETTINGS_ACTIONS.map((action) => ({
    ...action,
    href: action.href ? appendWorkspaceParam(action.href, workspaceId) : action.href,
  }));
}

export function selectCurrentWorkspace(
  workspaces: ShellWorkspace[],
  workspaceId: string | null,
): ShellWorkspace | null {
  if (workspaces.length === 0) return null;
  if (!workspaceId) return workspaces[0] ?? null;
  return workspaces.find((workspace) => workspace.id === workspaceId) ?? workspaces[0] ?? null;
}

export function buildWorkspaceSwitchHref(currentPath: string, workspaceId: string): string {
  const [pathname = "/", queryString = ""] = currentPath.split("?");
  const params = new URLSearchParams(queryString);
  params.set("workspace", workspaceId);
  const nextQuery = params.toString();
  return nextQuery ? `${pathname}?${nextQuery}` : pathname;
}
