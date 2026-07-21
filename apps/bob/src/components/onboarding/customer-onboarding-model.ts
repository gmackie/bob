export type CustomerOnboardingStepKey =
  | "github-auth"
  | "workspace"
  | "repo-import"
  | "forgegraph-token"
  | "daemon"
  | "first-task-run";

export interface CustomerOnboardingStep {
  key: CustomerOnboardingStepKey;
  title: string;
  description: string;
  actionLabel: string;
  href: string;
  owner: "Account" | "Workspace" | "Repository" | "ForgeGraph" | "Execution";
}

const CUSTOMER_ONBOARDING_STEPS: CustomerOnboardingStep[] = [
  {
    key: "github-auth",
    title: "Sign in with GitHub",
    description:
      "Connect the customer account so Bob can read GitHub identity and repository access.",
    actionLabel: "Open Git provider settings",
    href: "/settings?section=git-providers",
    owner: "Account",
  },
  {
    key: "workspace",
    title: "Create a workspace",
    description:
      "Create the first workspace that will own projects, repositories, agents, and task history.",
    actionLabel: "Create workspace",
    href: "/planning",
    owner: "Workspace",
  },
  {
    key: "repo-import",
    title: "Import a repository",
    description:
      "Import the customer repository from GitHub and map it to a project for planning and execution.",
    actionLabel: "Import from GitHub",
    href: "/planning/projects",
    owner: "Repository",
  },
  {
    key: "forgegraph-token",
    title: "Create the ForgeGraph token",
    description:
      "Add the ForgeGraph API token Bob uses for deployment pipeline integration.",
    actionLabel: "Connect ForgeGraph",
    href: "/settings?section=git-providers",
    owner: "ForgeGraph",
  },
  {
    key: "daemon",
    title: "Connect the daemon",
    description:
      "Start the local daemon, confirm it appears as an active node, and verify workspace connectivity.",
    actionLabel: "View nodes",
    href: "/nodes",
    owner: "ForgeGraph",
  },
  {
    key: "first-task-run",
    title: "Run the first task",
    description:
      "Create or promote a task, dispatch it to an agent, and confirm the first run produces activity.",
    actionLabel: "Open task queue",
    href: "/tasks/queue",
    owner: "Execution",
  },
];

export function getCustomerOnboardingSteps(): CustomerOnboardingStep[] {
  return CUSTOMER_ONBOARDING_STEPS.map((step) => ({ ...step }));
}

export function getCustomerOnboardingStepNumber(index: number): string {
  return String(index + 1).padStart(2, "0");
}

export function getCustomerOnboardingHref(
  workspaceId?: string | null,
): string {
  if (!workspaceId) return "/onboarding";
  const params = new URLSearchParams({ workspace: workspaceId });
  return `/onboarding?${params.toString()}`;
}

export function getCustomerOnboardingStepHref(
  step: CustomerOnboardingStep,
  workspaceId?: string | null,
): string {
  if (!workspaceId) return step.href;

  const [pathname = step.href, queryString = ""] = step.href.split("?");
  if (!isWorkspaceScopedStepPath(pathname)) return step.href;

  const params = new URLSearchParams(queryString);
  params.set("workspace", workspaceId);
  const query = params.toString();
  return query ? `${pathname}?${query}` : pathname;
}

function isWorkspaceScopedStepPath(pathname: string): boolean {
  return (
    pathname === "/onboarding" ||
    pathname === "/planning" ||
    pathname === "/planning/projects" ||
    pathname === "/tasks/queue"
  );
}
