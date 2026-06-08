export interface PlanningShellTab {
  href: "/planning" | "/planning/projects";
  label: "Recent Sessions" | "Projects";
}

export type PlanningShellRoute =
  | "/planning"
  | "/planning/projects"
  | "/planning/sessions";

export interface PlanningShellTitle {
  heading: string;
  subtitle: string | null;
}

export interface PlanningShellAction {
  key: "start-planning-session" | "import-github-project" | "create-project";
  label: string;
}

const PLANNING_SHELL_TABS: PlanningShellTab[] = [
  { href: "/planning", label: "Recent Sessions" },
  { href: "/planning/projects", label: "Projects" },
];

const PLANNING_SHELL_TITLES: Record<PlanningShellRoute, PlanningShellTitle> = {
  "/planning": {
    heading: "Planning",
    subtitle: null,
  },
  "/planning/projects": {
    heading: "Projects",
    subtitle: null,
  },
  "/planning/sessions": {
    heading: "Planning Session",
    subtitle: null,
  },
};

export function getPlanningShellTabs(): PlanningShellTab[] {
  return [...PLANNING_SHELL_TABS];
}

export function shouldRenderPlanningWorkspaceTabs(): boolean {
  return false;
}

export function matchPlanningShellRoute(pathname: string): PlanningShellRoute | null {
  const path = pathname.split("?")[0] ?? pathname;
  if (path === "/planning" || path === "/planning/") return "/planning";
  if (path.startsWith("/planning/projects")) return "/planning/projects";
  if (path.startsWith("/planning/sessions")) return "/planning/sessions";
  return null;
}

export function getPlanningShellTitle(route: PlanningShellRoute): PlanningShellTitle {
  return PLANNING_SHELL_TITLES[route];
}

export function getPlanningShellActions(route: PlanningShellRoute): PlanningShellAction[] {
  switch (route) {
    case "/planning":
      return [{ key: "start-planning-session", label: "+ Planning" }];
    case "/planning/projects":
      return [
        { key: "import-github-project", label: "Import from GitHub" },
        { key: "create-project", label: "Create Project" },
      ];
    case "/planning/sessions":
      return [];
  }
}

export function getPlanningProjectQueryRefreshOptions(): {
  staleTime: number;
  refetchInterval: number;
} {
  return {
    staleTime: 15_000,
    refetchInterval: 15_000,
  };
}

export function getPlanningDashboardHref(workspaceId?: string | null): string {
  if (!workspaceId) return "/planning";
  const params = new URLSearchParams({ workspace: workspaceId });
  return `/planning?${params.toString()}`;
}

export function getLegacyPlanningBoardRedirectHref(
  searchParams?: string | URLSearchParams | null,
): string {
  const params =
    typeof searchParams === "string"
      ? new URLSearchParams(searchParams)
      : searchParams;
  const nextParams = new URLSearchParams();
  const lane = params?.get("lane");
  const workspace = params?.get("workspace");

  if (lane) nextParams.set("lane", lane);
  if (workspace) nextParams.set("workspace", workspace);

  const query = nextParams.toString();
  return query ? `/tasks/queue?${query}` : "/tasks/queue";
}

export function getPlanningDispatchHref(
  batchId: string,
  workspaceId?: string | null,
): string {
  if (!workspaceId) return `/planning/dispatch/${batchId}`;
  const params = new URLSearchParams({ workspace: workspaceId });
  return `/planning/dispatch/${batchId}?${params.toString()}`;
}

export function getPlanningSessionHref(
  sessionId: string,
  workspaceId?: string | null,
): string {
  if (!workspaceId) return `/planning/sessions/${sessionId}`;
  const params = new URLSearchParams({ workspace: workspaceId });
  return `/planning/sessions/${sessionId}?${params.toString()}`;
}
