/** Wire types for the cockpit status payload. Pure data; safe to share with the client. */

export type PriorityLane = "urgent" | "high" | "medium" | "unset" | "low";

export interface QueueCard {
  id: string;
  identifier: string | null;
  title: string;
  repo: string | null;
  lane: PriorityLane;
  ready: boolean;
  agentOverride: string | null;
  provider: string | null; // linear | ooda | null
  ageMinutes: number;
}

/**
 * Rollup of an agent's own verification (check-events v2 `summarizeChecks`),
 * persisted by the runner as one `check` session event with phase "all" when
 * the run ends. Survives reloads; the live per-test stream does not.
 */
export interface CheckPhaseRollup {
  phase: string;
  status: string; // running | passed | failed | skipped
  durationMs?: number;
  counts?: { passed: number; failed: number; skipped?: number; total?: number };
  confidence?: string; // exact | scraped
  failures: { name: string; suite?: string; message?: string }[];
}
export interface CheckRollup {
  status: "passed" | "failed";
  at: string;
  phases: CheckPhaseRollup[];
}

/**
 * ForgeGraph's view of CI for a commit: builds posted by the repo's own
 * workflows via /api/fg/ci/report (gate semantics), plus the structured
 * failure readout for a red build. Fills the gap when Forgejo has no commit
 * statuses on the PR head.
 */
export interface FgCiEvidence {
  app: string;
  status: "pass" | "pending" | "fail" | "none";
  hasCIHistory: boolean;
  builds: {
    id: string;
    pipelineName: string;
    status: string;
    runUrl: string;
    /** check-events v2 summary posted by the CI runner (exact per-phase counts), when the run produced one. */
    tests: CheckRollup | null;
  }[];
  failures: {
    headline: string;
    tests: { name: string; suite?: string; message?: string }[];
    errors: string[];
  } | null;
}

export interface LiveSession {
  id: string;
  agent: string;
  status: string;
  phase: "execute" | "review" | "repair" | "other";
  title: string;
  identifier: string | null;
  workItemId: string | null;
  repo: string | null;
  branch: string | null;
  startedAt: string;
  elapsedSeconds: number;
  pr: { number: number; repo: string; url: string } | null;
  provider: string | null;
  /** Persisted end-of-run verification rollup, if the agent ran bob-check. */
  check: CheckRollup | null;
}

export type PipelineStageState = "done" | "active" | "failed" | "waiting" | "skipped";

export interface PrPipeline {
  id: string;
  repo: string;
  number: number;
  url: string;
  title: string;
  identifier: string | null;
  headSha: string | null;
  openedAt: string;
  stages: {
    code: PipelineStageState;
    ci: PipelineStageState;
    review: PipelineStageState;
    repair: PipelineStageState;
    merge: PipelineStageState;
    deploy: PipelineStageState;
  };
  ci: { state: string; jobs: { name: string; status: string }[] } | null;
  /** ForgeGraph builds for the head SHA (null when FG is unconfigured or the repo has no FG app). */
  fgCi: FgCiEvidence | null;
  /** The producing agent's own bob-check rollup at the end of its run. */
  agentCheck: CheckRollup | null;
  review: { verdict: string | null; by: string | null } | null;
  repair: { attempts: number; cap: number; inFlight: boolean };
  parkedReason: string | null;
}

export interface AgentHealthChip {
  agent: string;
  completed: number;
  errored: number;
  healthy: boolean;
  reason: string;
  inRotation: boolean;
}

export interface TimelineEvent {
  at: string;
  kind: "dispatch" | "pr" | "merge" | "deploy" | "deploy_failed" | "failure" | "review" | "human";
  agent: string | null;
  label: string;
  url?: string;
}

export interface CockpitStatus {
  generatedAt: string;
  loop: {
    lastTickAt: string | null; // newest driver activity we can observe
    tickAgeSeconds: number | null;
    syncedAt: string | null;
    syncAgeSeconds: number | null;
    syncResult: string | null;
    dispatchEnabled: boolean;
  };
  pacing: {
    cap: number;
    used: number;
    earned: number;
    allowance: number;
    burst: number;
    concurrency: number;
    activeSlots: number;
  };
  agents: AgentHealthChip[];
  queue: { lanes: Record<PriorityLane, QueueCard[]>; backlog: number; total: number };
  sessions: LiveSession[];
  prs: { active: PrPipeline[]; parked: PrPipeline[] };
  counts: { todo: number; inProgress: number; inReview: number; blocked: number; done: number; backlog: number };
  timeline: TimelineEvent[];
  sparklines: { dispatches: number[]; merges: number[]; errors: number[] }; // 24 hourly buckets, oldest first
  alerts: { id: string; message: string; since: string | null }[];
}
