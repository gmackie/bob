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

/**
 * Append one digest-only `agent_run` record for a Bob task-execution session.
 *
 * `source: "bob"` — this daemon only runs Bob's own work. The runner's thread
 * path reports `"ooda"`; Skillfleet's collector validates source per adapter
 * and silently drops records whose source does not match, so the two must not
 * be conflated.
 *
 * Naturally dark: with `options` omitted the emitter resolves its journal path
 * from `SKILLFLEET_WORKFLOW_JOURNAL` and returns `disabled` when unset. Failure
 * -isolated inside the emitter, so a journal problem can never fail a session.
 */
export function recordBobSessionOutcome(
  outcome: BobSessionOutcome,
  options?: { journalPath?: string | null },
) {
  return emitSkillfleetWorkflowEvent(
    {
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
    },
    options,
  );
}
