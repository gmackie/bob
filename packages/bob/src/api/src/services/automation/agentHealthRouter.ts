/**
 * Health-gated agent rotation (pure).
 *
 * auto-drain rotates across agent types so load spreads over providers. That
 * is blind: on 2026-08-21 codex (expired ChatGPT auth) and then claude (weekly
 * subscription limit) each kept receiving a quarter of all dispatches — and
 * every one of those sessions exited 1 within seconds — until a human pulled
 * them from BOB_AUTO_DRAIN_AGENTS by hand. This router looks at each agent's
 * recent outcomes and skips the ones that are currently failing hard, keeping
 * the round-robin order for the rest. If EVERY agent looks unhealthy the plain
 * rotation is used (a broken runner must not stop dispatch entirely; the
 * starvation alert covers that case).
 */

export interface AgentRecentStats {
  agent: string;
  completed: number;
  errored: number;
}

export interface HealthGateOptions {
  /** Consecutive-ish errors with zero completions that mark an agent unhealthy. */
  minErrorsNoSuccess?: number;
  /** Error ratio (errored / total) above which an agent is unhealthy, given enough samples. */
  maxErrorRatio?: number;
  minSamplesForRatio?: number;
}

export interface AgentHealthVerdict {
  agent: string;
  healthy: boolean;
  reason: string;
}

export function assessAgentHealth(
  rotation: string[],
  stats: AgentRecentStats[],
  opts: HealthGateOptions = {},
): AgentHealthVerdict[] {
  const minErrorsNoSuccess = opts.minErrorsNoSuccess ?? 3;
  const maxErrorRatio = opts.maxErrorRatio ?? 0.8;
  const minSamples = opts.minSamplesForRatio ?? 5;
  const byAgent = new Map(stats.map((s) => [s.agent, s]));
  return rotation.map((agent) => {
    const s = byAgent.get(agent);
    if (!s || s.completed + s.errored === 0) return { agent, healthy: true, reason: "no recent data" };
    const total = s.completed + s.errored;
    if (s.completed === 0 && s.errored >= minErrorsNoSuccess) {
      return { agent, healthy: false, reason: `${s.errored} errors, 0 completions` };
    }
    if (total >= minSamples && s.errored / total > maxErrorRatio) {
      return { agent, healthy: false, reason: `${s.errored}/${total} errored` };
    }
    return { agent, healthy: true, reason: `${s.completed}✓ ${s.errored}✗` };
  });
}

/**
 * Pick the agent for the i-th dispatch of the day: round-robin over the healthy
 * subset, falling back to the full rotation when nothing is healthy.
 */
export function chooseAgent(
  rotation: string[],
  verdicts: AgentHealthVerdict[],
  index: number,
): { agent: string; skipped: AgentHealthVerdict[] } {
  const skipped = verdicts.filter((v) => !v.healthy);
  const healthy = rotation.filter((a) => !skipped.some((v) => v.agent === a));
  const pool = healthy.length ? healthy : rotation;
  const agent = pool[((index % pool.length) + pool.length) % pool.length] ?? rotation[0] ?? "claude";
  return { agent, skipped: healthy.length ? skipped : [] };
}
