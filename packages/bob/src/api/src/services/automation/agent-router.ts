/**
 * Agent Routing Service — B.4
 *
 * Pure-function scoring engine that ranks available agent instances
 * for a given task context.  No DB access — the dispatch system
 * feeds candidates in and consumes the sorted result.
 */

export interface AgentCandidate {
  instanceId: string;
  agentType: string;
  status: string;
  score: number;
  reasons: string[];
}

export interface TaskContext {
  workItemId: string;
  kind: string; // "task", "epic", "issue"
  title: string;
  requiredSkills?: string[];
  language?: string; // primary language of the repo
  repoId?: string;
}

export interface AvailableAgent {
  id: string;
  agentType: string;
  status: string;
  repositoryId?: string;
}

// ---------------------------------------------------------------------------
// Scoring constants
// ---------------------------------------------------------------------------

/** Points awarded (or deducted) based on agent status. */
const STATUS_SCORES: Record<string, number> = {
  idle: 5,
  running: 0,
  stopped: -10,
  error: -20,
};

/** Points awarded when agent is in the same repository as the task. */
const REPO_MATCH_BONUS = 10;

/**
 * Points awarded when the agent type matches the kind of work.
 * Code-centric tasks favour "claude"; ops tasks favour "cursor", etc.
 */
const CODE_TASK_KINDS = new Set(["task", "bug", "issue", "story"]);
const CODE_AGENT_TYPES = new Set(["claude", "cursor", "kiro"]);

const AGENT_TYPE_MATCH_BONUS = 5;

/**
 * Bonus when agent type matches the primary language of the repo.
 * Currently a simple heuristic — Claude handles all languages well,
 * so any code-capable agent gets a small language-match bonus.
 */
const LANGUAGE_MATCH_BONUS = 3;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Score each available agent against the given task context and return
 * candidates sorted by score descending (best first).
 *
 * This is intentionally a **pure function** with no side effects so it
 * can be unit-tested without mocks or DB fixtures.
 */
export function selectBestAgent(
  context: TaskContext,
  availableAgents: AvailableAgent[],
): AgentCandidate[] {
  return availableAgents
    .map((agent) => scoreAgent(context, agent))
    .sort((a, b) => b.score - a.score);
}

// ---------------------------------------------------------------------------
// Internal scoring
// ---------------------------------------------------------------------------

function scoreAgent(
  context: TaskContext,
  agent: AvailableAgent,
): AgentCandidate {
  let score = 0;
  const reasons: string[] = [];

  // 1. Availability
  const statusScore = STATUS_SCORES[agent.status] ?? -5;
  score += statusScore;
  reasons.push(`status=${agent.status} (${statusScore >= 0 ? "+" : ""}${statusScore})`);

  // 2. Repository match
  if (context.repoId && agent.repositoryId && agent.repositoryId === context.repoId) {
    score += REPO_MATCH_BONUS;
    reasons.push(`repo-match (+${REPO_MATCH_BONUS})`);
  }

  // 3. Agent type match for code-centric work
  if (CODE_TASK_KINDS.has(context.kind) && CODE_AGENT_TYPES.has(agent.agentType)) {
    score += AGENT_TYPE_MATCH_BONUS;
    reasons.push(`type-match: ${agent.agentType} for ${context.kind} (+${AGENT_TYPE_MATCH_BONUS})`);
  }

  // 4. Language affinity (light bonus when a code-capable agent matches a repo with a language)
  if (context.language && CODE_AGENT_TYPES.has(agent.agentType)) {
    score += LANGUAGE_MATCH_BONUS;
    reasons.push(`lang-affinity: ${context.language} (+${LANGUAGE_MATCH_BONUS})`);
  }

  // 5. Required skills hint — if the task lists skills and the agent type
  //    is a known code agent, give a small boost (placeholder for richer
  //    skill-capability mapping later).
  if (context.requiredSkills && context.requiredSkills.length > 0 && CODE_AGENT_TYPES.has(agent.agentType)) {
    const bonus = Math.min(context.requiredSkills.length, 3); // cap at 3
    score += bonus;
    reasons.push(`skills-hint x${context.requiredSkills.length} (+${bonus})`);
  }

  return {
    instanceId: agent.id,
    agentType: agent.agentType,
    status: agent.status,
    score,
    reasons,
  };
}
