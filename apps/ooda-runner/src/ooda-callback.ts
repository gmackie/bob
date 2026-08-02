// Read-back correlation for OODA-dispatched Bob runs (Phase 5 M2).
//
// A session dispatched via publicApi.dispatchExecution carries an opaque
// { ooda: { threadId?, threadSlug? } } under personaConfig.metadata (forwarded
// by the gateway's session_available). On completion the runner writes the run
// outcome back into the originating OODA thread via promoteNote.
//
// The write happens on the RUNNER, not over an HTTP callback: promoteNote does
// filesystem writes + a git commit, which the OODA web app (Cloudflare Workers,
// no fs/git) cannot do but the runner — which already owns the thread
// workspaces on disk — can. So the gateway connector extracts the correlation
// here and hands it to a runner-provided handler that calls promoteNote.
//
// Pure + side-effect-free so it's unit-testable. Naturally dark: returns null
// for any session without an ooda correlation (every session until Phase 5 M1
// dispatch is enabled), so the completion hook no-ops.

export interface OodaCorrelation {
  /** Thread workspace directory name (what resolveThreadPath expects). */
  threadSlug: string;
  /** Thread UUID, for entity extraction / provenance (optional). */
  threadId?: string;
}

type SessionLike = {
  personaConfig?: { metadata?: Record<string, unknown> } | null;
};

/**
 * Extract a valid OODA correlation from a session, or null. Requires a
 * resolvable thread identifier: `threadSlug` if present, else `threadId` used as
 * the slug. Anything else is treated as "not an OODA run" (dark).
 */
export function oodaCorrelationFrom(session: SessionLike): OodaCorrelation | null {
  const ooda = session.personaConfig?.metadata?.ooda as
    | { threadId?: unknown; threadSlug?: unknown }
    | undefined;
  if (!ooda || typeof ooda !== "object") return null;

  const threadId =
    typeof ooda.threadId === "string" && ooda.threadId.trim().length > 0
      ? ooda.threadId
      : undefined;
  const rawSlug =
    typeof ooda.threadSlug === "string" && ooda.threadSlug.trim().length > 0
      ? ooda.threadSlug
      : undefined;

  const threadSlug = rawSlug ?? threadId;
  if (!threadSlug) return null;
  return { threadSlug, threadId };
}

export interface BobRunOutcome {
  sessionId: string;
  status: "completed" | "failed";
  title?: string | null;
  pullRequestUrl?: string | null;
  branch?: string | null;
}

/** Build the note title + markdown body promoteNote writes for a Bob outcome. */
export function buildOutcomeNote(outcome: BobRunOutcome): {
  title: string;
  content: string;
} {
  const label = outcome.status === "completed" ? "completed" : "failed";
  const title = `Bob run ${label}: ${outcome.title ?? outcome.sessionId}`;
  const lines = [
    `A Bob run dispatched from this thread ${label}.`,
    "",
    `- Session: \`${outcome.sessionId}\``,
    `- Status: **${outcome.status}**`,
  ];
  if (outcome.branch) lines.push(`- Branch: \`${outcome.branch}\``);
  if (outcome.pullRequestUrl) lines.push(`- Pull request: ${outcome.pullRequestUrl}`);
  return { title, content: lines.join("\n") };
}
