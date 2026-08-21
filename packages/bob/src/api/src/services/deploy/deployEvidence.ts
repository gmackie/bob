/**
 * Deploy evidence for a merged PR, summarized from the two places a deploy
 * actually shows up today:
 *
 *  - Forgejo Actions: repos deploy themselves on push to the default branch
 *    via a `deploy.yml`-style workflow (e.g. "Deploy habit-app (apps/web)").
 *    A run on the merge commit whose name looks like a deploy IS the deploy.
 *  - ForgeGraph deployments: `/api/fg/deploy?appSlug=…` records keyed by
 *    `commitSha` for apps driven through ForgeGraph's own pipeline.
 *
 * Pure: no I/O, so the precedence rules are unit-testable.
 */

export type DeployOutcome = "none" | "pending" | "success" | "failure";

export interface ActionRunEvidence {
  name: string;
  /** Forgejo run status: success | failure | cancelled | running | waiting | … */
  status: string;
  headSha: string;
  url?: string;
}

export interface FgDeploymentEvidence {
  commitSha: string | null;
  /** ForgeGraph status: active | deploying | pending | failed | rolled_back | … */
  status: string;
  stage?: string | null;
  failureReason?: string | null;
  url?: string;
}

export interface DeployDetail {
  source: "actions" | "forgegraph";
  label: string;
  status: Exclude<DeployOutcome, "none">;
  url?: string;
  note?: string;
}

export interface DeploySummary {
  outcome: DeployOutcome;
  details: DeployDetail[];
}

const DEPLOY_NAME = /deploy|release|publish|ship/i;

function shaMatches(a: string | null | undefined, b: string): boolean {
  if (!a || !b) return false;
  const x = a.toLowerCase();
  const y = b.toLowerCase();
  return x.startsWith(y) || y.startsWith(x);
}

function actionStatus(s: string): DeployDetail["status"] {
  const v = s.toLowerCase();
  if (v === "success") return "success";
  if (v === "failure" || v === "cancelled" || v === "canceled" || v === "skipped")
    return "failure";
  return "pending";
}

function fgStatus(s: string): DeployDetail["status"] {
  const v = s.toLowerCase();
  if (v === "active" || v === "succeeded" || v === "healthy" || v === "completed")
    return "success";
  if (v === "failed" || v === "rolled_back" || v === "unhealthy" || v === "aborted")
    return "failure";
  return "pending";
}

export function summarizeDeployEvidence(input: {
  mergeSha: string;
  actionRuns: ActionRunEvidence[];
  fgDeployments: FgDeploymentEvidence[];
}): DeploySummary {
  const details: DeployDetail[] = [];

  for (const run of input.actionRuns) {
    if (!shaMatches(run.headSha, input.mergeSha)) continue;
    if (!DEPLOY_NAME.test(run.name)) continue;
    details.push({
      source: "actions",
      label: run.name,
      status: actionStatus(run.status),
      url: run.url,
    });
  }

  for (const d of input.fgDeployments) {
    if (!shaMatches(d.commitSha, input.mergeSha)) continue;
    details.push({
      source: "forgegraph",
      label: d.stage ?? "deployment",
      status: fgStatus(d.status),
      url: d.url,
      note: d.failureReason ?? undefined,
    });
  }

  let outcome: DeployOutcome = "none";
  if (details.some((d) => d.status === "failure")) outcome = "failure";
  else if (details.some((d) => d.status === "pending")) outcome = "pending";
  else if (details.some((d) => d.status === "success")) outcome = "success";

  return { outcome, details };
}
