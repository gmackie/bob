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
  | "kanbanger.issue"
  | "kanbanger.board";

export interface ExternalLinkConfig {
  forgegraphScheme: string;
  forgegraphWebOrigin: string;
  kanbangerScheme: string;
  kanbangerWebOrigin: string;
}

export interface ExternalLinkRequest {
  target: ExternalTarget;
  id?: string;
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
  "kanbanger.issue": { app: "kanbanger", path: "issues", requiresId: true },
  "kanbanger.board": { app: "kanbanger", path: "boards", requiresId: false },
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

  const scheme =
    spec.app === "forgegraph" ? config.forgegraphScheme : config.kanbangerScheme;
  const origin =
    spec.app === "forgegraph" ? config.forgegraphWebOrigin : config.kanbangerWebOrigin;
  // An unconfigured app yields no link at all, rather than a broken one.
  if (!scheme || !origin) return null;

  // Ids come from server data and can contain slashes; encoding stops one
  // forging extra path segments.
  const suffix = request.id ? `/${encodeURIComponent(request.id)}` : "";

  return {
    appUrl: `${scheme}://${spec.path}${suffix}`,
    webUrl: `${origin.replace(/\/+$/, "")}/${spec.path}${suffix}`,
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

  // Kanbanger issue and board detail render inside Bob. The link out exists
  // for the things Bob does not do — editing the board, say — not for reading.
  const shownInBob = target === "kanbanger.issue" || target === "kanbanger.board";

  return { primary: shownInBob ? "in_app" : "external", externalLabel: label };
}
