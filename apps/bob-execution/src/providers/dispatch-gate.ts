/**
 * Should the runner dispatch at all, and to whom?
 *
 * This deliberately reconciles two opposing decisions rather than overriding
 * one. `agentHealthRouter.ts` documents, on purpose:
 *
 *   "If EVERY agent looks unhealthy the plain rotation is used (a broken runner
 *    must not stop dispatch entirely; the starvation alert covers that case)."
 *
 * That guard exists because `assessAgentHealth` *infers* unhealth from run
 * statistics, and halting an entire backlog on a statistical artifact is a
 * wedge with no way out. But on 2026-08-29 the opposite failure happened: three
 * agents were *confirmed* dead — two unauthenticated, one authenticated with an
 * exhausted balance — and the runner kept dispatching into them for eight days.
 *
 * The reconciliation is the kind of evidence:
 *
 *   - CONFIRMED (probe said unauthenticated / unavailable, or a real 402
 *     latched no_credit): dispatch cannot succeed. Halt.
 *   - UNCERTAIN (anything else, including statuses this build has never seen):
 *     fall through and actually try. Never halt.
 *
 * Both guarantees then hold at once.
 */

export type DispatchRemedy = "sign_in" | "top_up" | "install";

/** Structurally typed so the runner can pass raw JSON from agent-health. */
export interface HealthLike {
  name: string;
  status: string;
  detail?: string;
}

export interface BlockedAgent {
  agent: string;
  status: string;
  detail?: string;
  remedy: DispatchRemedy;
}

export interface GateDecision {
  agent: string | null;
  paused: boolean;
  reason: string;
  blocked: BlockedAgent[];
}

/**
 * Statuses that constitute proof a dispatch cannot succeed. Kept as an explicit
 * allowlist: an unrecognised status must never be read as confirmation, so new
 * or renamed statuses fail safe toward dispatching rather than toward halting.
 */
const CONFIRMED_DEAD: Record<string, DispatchRemedy> = {
  unauthenticated: "sign_in",
  no_credit: "top_up",
  unavailable: "install",
};

export function decideDispatch(
  preference: readonly string[],
  agents: readonly HealthLike[],
  opts: { override?: boolean } = {},
): GateDecision {
  const byName = new Map(agents.map((a) => [a.name, a]));
  const considered = preference.map((name) => ({ name, health: byName.get(name) }));

  const blocked: BlockedAgent[] = considered.flatMap(({ name, health }) => {
    if (!health) return [];
    const remedy = CONFIRMED_DEAD[health.status];
    return remedy ? [{ agent: name, status: health.status, detail: health.detail, remedy }] : [];
  });

  const ready = considered.find(({ health }) => health?.status === "ready");
  // Anything neither ready nor confirmed dead: unknown, degraded, or simply
  // absent from the report. Uncertain, therefore still worth trying.
  const uncertain = considered.find(
    ({ health }) => !health || (health.status !== "ready" && !CONFIRMED_DEAD[health.status]),
  );

  if (opts.override) {
    return {
      agent: ready?.name ?? uncertain?.name ?? preference[0] ?? null,
      paused: false,
      reason: "manual override — dispatching despite confirmed-dead agents",
      blocked,
    };
  }

  if (ready) {
    return { agent: ready.name, paused: false, reason: `${ready.name} is ready`, blocked };
  }

  if (uncertain) {
    return {
      agent: uncertain.name,
      paused: false,
      reason: `no agent confirmed ready; trying ${uncertain.name} on uncertain evidence`,
      blocked,
    };
  }

  return {
    agent: null,
    paused: true,
    reason: `dispatch paused — every agent is confirmed unavailable: ${blocked
      .map((b) => `${b.agent} (${b.status})`)
      .join(", ")}`,
    blocked,
  };
}
