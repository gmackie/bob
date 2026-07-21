/**
 * Access audit for cookie and session-secret plaintext material.
 *
 * Never logs plaintext values. Events go to:
 *   1. Structured JSON lines on stdout (prefix `[secret-access-audit]`) for log
 *      shipping / SIEM.
 *   2. An in-process ring buffer used by tests and local diagnostics.
 *
 * Session-secret decrypt paths also write durable rows to `session_secret_usages`
 * (handled by SessionSecretService). This module is the shared non-DB layer.
 */

export type SecretAccessResource =
  | "session_secret"
  | "browser_cookie"
  | "git_token";

export type SecretAccessAction =
  | "decrypt"
  | "decrypt_for_session"
  | "import"
  | "rotate";

export interface SecretAccessEvent {
  readonly at: string; // ISO-8601
  readonly resource: SecretAccessResource;
  readonly action: SecretAccessAction;
  readonly userId?: string;
  readonly sessionId?: string;
  readonly resourceId?: string;
  readonly domain?: string;
  readonly count?: number;
  readonly success: boolean;
  readonly detail?: string;
}

const RING_MAX = 500;
const recentEvents: SecretAccessEvent[] = [];

function pushEvent(event: SecretAccessEvent): void {
  recentEvents.push(event);
  if (recentEvents.length > RING_MAX) {
    recentEvents.splice(0, recentEvents.length - RING_MAX);
  }
}

/**
 * Record a secret-material access event. Never include plaintext secrets.
 */
export function auditSecretAccess(
  input: Omit<SecretAccessEvent, "at"> & { at?: string },
): SecretAccessEvent {
  const event: SecretAccessEvent = {
    at: input.at ?? new Date().toISOString(),
    resource: input.resource,
    action: input.action,
    userId: input.userId,
    sessionId: input.sessionId,
    resourceId: input.resourceId,
    domain: input.domain,
    count: input.count,
    success: input.success,
    detail: input.detail,
  };

  pushEvent(event);

  // Structured log line for operators / log pipelines. Values never included.
  console.info(
    `[secret-access-audit] ${JSON.stringify({
      at: event.at,
      resource: event.resource,
      action: event.action,
      userId: event.userId,
      sessionId: event.sessionId,
      resourceId: event.resourceId,
      domain: event.domain,
      count: event.count,
      success: event.success,
      detail: event.detail,
    })}`,
  );

  return event;
}

/** Snapshot of the in-process ring buffer (newest last). */
export function getRecentSecretAccessEvents(): readonly SecretAccessEvent[] {
  return recentEvents.slice();
}

/** Test helper — clears the ring buffer. */
export function clearSecretAccessEvents(): void {
  recentEvents.length = 0;
}
