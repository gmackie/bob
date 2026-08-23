/**
 * Choose an agent for a fixed-role job (review, repair) with a health fallback.
 *
 * auto-drain's rotation is health-gated, but review and repair are pinned to a
 * single configured agent — so when that agent's credentials died, every tick
 * re-dispatched to it and it failed within seconds: 392 review sessions burned
 * in 24h on 2026-08-23 (codex, expired ChatGPT auth) with zero reviews landing
 * and the merge gate frozen shut behind them.
 *
 * The configured agent is always preferred. Only when it is demonstrably
 * unhealthy do we fall back to the healthiest alternative; if nothing looks
 * healthy we keep the configured one (better a known role than silent churn,
 * and the starvation/digest signals will surface it).
 */
import { assessAgentHealth  } from "./agentHealthRouter.js";
import type {AgentRecentStats} from "./agentHealthRouter.js";

export interface PickHealthyAgentResult {
  agent: string;
  fellBack: boolean;
  reason?: string;
}

export function pickHealthyAgent(
  configured: string,
  candidates: readonly string[],
  stats: readonly AgentRecentStats[],
): PickHealthyAgentResult {
  const pool = [configured, ...candidates.filter((c) => c !== configured)];
  const verdicts = assessAgentHealth(pool, [...stats]);
  const byAgent = new Map(verdicts.map((v) => [v.agent, v]));

  const configuredVerdict = byAgent.get(configured);
  if (!configuredVerdict || configuredVerdict.healthy) return { agent: configured, fellBack: false };

  const alternative = pool.find((a) => a !== configured && byAgent.get(a)?.healthy);
  if (!alternative) return { agent: configured, fellBack: false, reason: "no healthy alternative" };

  return {
    agent: alternative,
    fellBack: true,
    reason: `${configured} unhealthy (${configuredVerdict.reason})`,
  };
}
