import {
  emitSkillfleetWorkflowEvent,
  normalizeSkillfleetRuntime,
} from "@gmacko/core/skillfleet-bridge";

interface BobSessionOutcome {
  sessionId: string;
  projectId: string | null;
  agentType: string;
  status: "success" | "failure" | "cancelled" | "blocked";
  durationMs: number;
  observedAt: string;
}

export function recordBobSessionOutcome(
  outcome: BobSessionOutcome,
  options?: { journalPath?: string | null },
) {
  return emitSkillfleetWorkflowEvent({
    source: "bob",
    identity: `${outcome.sessionId}:terminal`,
    observedAt: outcome.observedAt,
    sessionId: outcome.sessionId,
    projectId: outcome.projectId,
    provenanceQuality: "direct",
    kind: "agent_run",
    payload: {
      runtime: normalizeSkillfleetRuntime(outcome.agentType),
      status: outcome.status,
      durationMs: outcome.durationMs,
      turnCount: 1,
    },
  }, options);
}
