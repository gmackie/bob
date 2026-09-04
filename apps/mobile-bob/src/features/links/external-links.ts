/**
 * Deep links out of Bob to the sibling apps.
 *
 * The rule that matters: Bob is where you review, so a link OUT is an escape
 * hatch for what Bob cannot show — not the default path. Most Kanbanger issue
 * detail already renders inside Bob, so sending someone to another app to read
 * what is already on their screen is a regression dressed as an integration.
 * ForgeGraph is the opposite: deploys, nodes, CI and alerts have no Bob
 * equivalent, so those links are primary.
 *
 * Every link carries both a native scheme and an https fallback. A teammate
 * without the app installed still has to be able to follow it, and on the road
 * that is the common case.
 */

export type ExternalTarget =
  | "forgegraph.app"
  | "forgegraph.node"
  | "forgegraph.ci"
  | "forgegraph.alerts"
  | "forgegraph.pullRequests"
  | "kanbanger.tasks"
  | "kanbanger.myTasks"
  | "kanbanger.triage"
  | "kanbanger.cycles";

export interface ExternalLinkConfig {
  forgegraphScheme: string;
  forgegraphWebOrigin: string;
  kanbangerScheme: string;
  kanbangerWebOrigin: string;
}

export interface ExternalLinkRequest {
  target: ExternalTarget;
  id?: string;
  /** Required by every KanBanger target; its routes are workspace-scoped. */
  workspaceSlug?: string;
}

export interface ExternalLink {
  /** Native scheme; opens the app when installed. */
  appUrl: string;
  /** https equivalent, for when it is not. */
  webUrl: string;
  label: string;
}

interface TargetSpec {
  app: "forgegraph" | "kanbanger";
  /** Path segments after the origin. */
  path: string;
  /** Detail screens need an id; index screens do not. */
  requiresId: boolean;
  /**
   * KanBanger scopes everything under /dashboard/:workspaceSlug, so its links
   * need a workspace as well as an id. Reading its routes rather than
   * assuming a flat /issues/:id is what stopped this shipping as 404s.
   */
  workspaceScoped?: boolean;
}

const TARGETS: Record<ExternalTarget, TargetSpec> = {
  "forgegraph.app": { app: "forgegraph", path: "apps", requiresId: true },
  "forgegraph.node": { app: "forgegraph", path: "nodes", requiresId: true },
  "forgegraph.ci": { app: "forgegraph", path: "ci", requiresId: true },
  "forgegraph.alerts": { app: "forgegraph", path: "alerts", requiresId: false },
  "forgegraph.pullRequests": {
    app: "forgegraph",
    path: "pull-requests",
    requiresId: false,
  },
  // Paths read from linear-clone/apps/web/src/app/dashboard/[workspaceSlug]/.
  "kanbanger.tasks": {
    app: "kanbanger",
    path: "tasks/all",
    requiresId: false,
    workspaceScoped: true,
  },
  "kanbanger.myTasks": {
    app: "kanbanger",
    path: "tasks/my",
    requiresId: false,
    workspaceScoped: true,
  },
  "kanbanger.triage": {
    app: "kanbanger",
    path: "triage",
    requiresId: false,
    workspaceScoped: true,
  },
  "kanbanger.cycles": {
    app: "kanbanger",
    path: "cycles",
    requiresId: false,
    workspaceScoped: true,
  },
};

const APP_LABELS = { forgegraph: "ForgeGraph", kanbanger: "KanBanger" } as const;

export function buildExternalLink(
  request: ExternalLinkRequest,
  config: ExternalLinkConfig,
): ExternalLink | null {
  const spec = TARGETS[request.target];
  if (!spec) return null;

  // A link to a detail screen with no id lands on an error page. Rendering no
  // affordance is better than rendering one that fails.
  if (spec.requiresId && !request.id) return null;
  // Same for a workspace-scoped path with no workspace.
  if (spec.workspaceScoped && !request.workspaceSlug) return null;

  const scheme =
    spec.app === "forgegraph" ? config.forgegraphScheme : config.kanbangerScheme;
  const origin =
    spec.app === "forgegraph" ? config.forgegraphWebOrigin : config.kanbangerWebOrigin;
  // An unconfigured app yields no link at all, rather than a broken one.
  if (!scheme || !origin) return null;

  // Ids come from server data and can contain slashes; encoding stops one
  // forging extra path segments.
  const suffix = request.id ? `/${encodeURIComponent(request.id)}` : "";
  const prefix = spec.workspaceScoped
    ? `dashboard/${encodeURIComponent(request.workspaceSlug!)}/`
    : "";
  const path = `${prefix}${spec.path}${suffix}`;

  return {
    appUrl: `${scheme}://${path}`,
    webUrl: `${origin.replace(/\/+$/, "")}/${path}`,
    label: `Open in ${APP_LABELS[spec.app]}`,
  };
}

export interface LinkAffordance {
  /**
   * `in_app` when Bob already shows this well: the external link stays as a
   * secondary action. `external` when Bob has no equivalent and the other app
   * is genuinely the answer.
   */
  primary: "in_app" | "external";
  externalLabel: string;
}

export function linkAffordance(target: ExternalTarget): LinkAffordance {
  const spec = TARGETS[target];
  const label = `Open in ${APP_LABELS[spec.app]}`;

  // KanBanger task detail renders inside Bob. The link out exists for what Bob
  // does not do — reordering a cycle, triaging a board — not for reading.
  const shownInBob = target === "kanbanger.tasks" || target === "kanbanger.myTasks";

  return { primary: shownInBob ? "in_app" : "external", externalLabel: label };
}
