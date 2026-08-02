// Read-back correlation for OODA-dispatched Bob runs (Phase 5 M2).
//
// A session dispatched via publicApi.dispatchExecution carries an opaque
// { ooda: { threadId, callbackUrl } } under personaConfig.metadata (forwarded
// by the gateway's session_available). On completion the runner POSTs the run
// outcome back to callbackUrl so it can land in the originating OODA thread.
//
// Kept pure + side-effect-free so it's unit-testable without a live session.
// It's naturally dark: it returns null for any session that doesn't carry a
// valid ooda callback (i.e. every session except an OODA-dispatched one), so
// the completion hook no-ops until Phase 5 M1 dispatch is actually enabled.

export interface OodaCallback {
  threadId: string;
  callbackUrl: string;
}

export interface OodaOutcome {
  externalSessionId: string;
  status: "completed" | "failed";
  title?: string | null;
  pullRequestUrl?: string | null;
  branch?: string | null;
}

type SessionLike = {
  personaConfig?: { metadata?: Record<string, unknown> } | null;
};

/**
 * Extract a valid OODA callback from a session, or null. Requires both a
 * non-empty threadId and an http(s) callbackUrl — anything else is treated as
 * "no callback" (dark).
 */
export function oodaCallbackFrom(session: SessionLike): OodaCallback | null {
  const ooda = session.personaConfig?.metadata?.ooda as
    | { threadId?: unknown; callbackUrl?: unknown }
    | undefined;
  if (!ooda || typeof ooda !== "object") return null;

  const threadId =
    typeof ooda.threadId === "string" && ooda.threadId.trim().length > 0
      ? ooda.threadId
      : null;
  const callbackUrl =
    typeof ooda.callbackUrl === "string" && /^https?:\/\//.test(ooda.callbackUrl)
      ? ooda.callbackUrl
      : null;

  if (!threadId || !callbackUrl) return null;
  return { threadId, callbackUrl };
}

/** Build the JSON body POSTed to the OODA callback. */
export function buildOodaOutcomeBody(
  callback: OodaCallback,
  outcome: OodaOutcome,
): Record<string, unknown> {
  return {
    threadId: callback.threadId,
    externalSessionId: outcome.externalSessionId,
    status: outcome.status,
    title: outcome.title ?? null,
    pullRequestUrl: outcome.pullRequestUrl ?? null,
    branch: outcome.branch ?? null,
  };
}
