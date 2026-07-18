import type { HermesCronJob, HermesOAuthProvider, HermesStatus } from "./client.js";

export interface HermesHealth {
  tone: "success" | "danger";
  label: "Operational" | "Needs attention";
  issues: string[];
}

export function deriveHermesHealth(input: {
  status: Pick<HermesStatus, "gateway_running" | "gateway_state">;
  providers: Array<Pick<HermesOAuthProvider, "status">>;
}): HermesHealth {
  const issues: string[] = [];
  if (!input.status.gateway_running) {
    issues.push(`Gateway is ${input.status.gateway_state || "stopped"}`);
  }
  if (
    input.providers.length > 0 &&
    !input.providers.some((provider) => provider.status.logged_in)
  ) {
    issues.push("No provider authentication is active");
  }
  return issues.length > 0
    ? { tone: "danger", label: "Needs attention", issues }
    : { tone: "success", label: "Operational", issues: [] };
}

export function findLastBriefing(jobs: HermesCronJob[]): HermesCronJob | null {
  return jobs
    .filter((job) => (job.name ?? "").toLowerCase().includes("morning briefing"))
    .sort((a, b) => (b.last_run_at ?? "").localeCompare(a.last_run_at ?? ""))[0] ?? null;
}
