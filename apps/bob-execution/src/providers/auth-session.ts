/**
 * Pending browser-driven logins.
 *
 * State is in memory and deliberately not persisted: a device code has no
 * business in Postgres, and an interrupted login is meant to be retried rather
 * than resumed. A daemon restart drops everything here; the UI sees a fresh
 * connectorInstanceId on reconnect and marks outstanding requests expired.
 *
 * The PTY is injected so this is testable without a terminal, and so the
 * daemon owns the node-pty dependency.
 */

import type { ProviderId } from "./contract.js";
import type { AuthDriver } from "./auth-driver.js";
import { getAuthDriver } from "./auth-driver.js";
import { redactDetail } from "./credit.js";

export type AuthPhase = "spawning" | "awaiting_url" | "awaiting_code" | "verifying" | "done" | "failed";

export interface AuthPty {
  write(data: string): void;
  kill(): void;
  onData(cb: (chunk: string) => void): void;
  onExit(cb: (code: number) => void): void;
}

export interface AuthPrompt {
  requestId: string;
  provider: ProviderId;
  /** `raw` is the fail-open case: no matcher fired, so show the operator the tail. */
  kind: "url" | "await_code" | "raw";
  url?: string;
  /**
   * A code the operator must READ and type into their browser. codex prints one
   * separately; grok embeds it in the URL. Without it the flow cannot be
   * completed, so it is surfaced alongside the link.
   */
  code?: string;
  instructions: string;
  tail?: string;
}

export interface AuthResult {
  requestId: string;
  provider: ProviderId;
  ok: boolean;
  status: "authenticated" | "failed" | "expired" | "cancelled";
  detail?: string;
}

export interface AuthSessionOptions {
  spawn: (driver: AuthDriver) => AuthPty;
  onPrompt: (prompt: AuthPrompt) => void;
  onResult: (result: AuthResult) => void;
  /** How long to wait for a recognised URL before showing the raw tail. */
  urlTimeoutMs?: number;
  idleTimeoutMs?: number;
  hardTimeoutMs?: number;
}

interface Session {
  requestId: string;
  provider: ProviderId;
  driver: AuthDriver;
  pty: AuthPty;
  phase: AuthPhase;
  buffer: string;
  sawUrl: boolean;
  urlTimer?: ReturnType<typeof setTimeout>;
  idleTimer?: ReturnType<typeof setTimeout>;
  hardTimer?: ReturnType<typeof setTimeout>;
}

const MAX_BUFFER = 8_000;
const TAIL_CHARS = 600;

export class AuthSessionManager {
  private readonly sessions = new Map<string, Session>();
  private readonly urlTimeoutMs: number;
  private readonly idleTimeoutMs: number;
  private readonly hardTimeoutMs: number;

  constructor(private readonly opts: AuthSessionOptions) {
    this.urlTimeoutMs = opts.urlTimeoutMs ?? 15_000;
    this.idleTimeoutMs = opts.idleTimeoutMs ?? 300_000;
    this.hardTimeoutMs = opts.hardTimeoutMs ?? 600_000;
  }

  start(requestId: string, provider: ProviderId): { ok: boolean; error?: string } {
    if (this.sessions.has(requestId)) return { ok: false, error: "duplicate request id" };
    for (const session of this.sessions.values()) {
      // One login per provider. A second PTY would race the first for the same
      // credential file and neither operator would know which one won.
      if (session.provider === provider) {
        return { ok: false, error: `a login for ${provider} is already in progress` };
      }
    }

    // getAuthDriver is total over ProviderId, so there is no missing-driver case.
    const driver = getAuthDriver(provider);

    let pty: AuthPty;
    try {
      pty = this.opts.spawn(driver);
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : "spawn failed" };
    }

    const session: Session = {
      requestId,
      provider,
      driver,
      pty,
      phase: "awaiting_url",
      buffer: "",
      sawUrl: false,
    };
    this.sessions.set(requestId, session);

    pty.onData((chunk) => this.handleData(session, chunk));
    pty.onExit((code) => this.handleExit(session, code));

    session.urlTimer = setTimeout(() => this.failOpen(session), this.urlTimeoutMs);
    session.hardTimer = setTimeout(
      () => this.finish(session, { ok: false, status: "expired", detail: "login timed out" }),
      this.hardTimeoutMs,
    );
    this.touch(session);

    return { ok: true };
  }

  submitCode(requestId: string, value: string): boolean {
    const session = this.sessions.get(requestId);
    if (!session) return false;
    session.pty.write(`${value.trim()}\r`);
    session.phase = "verifying";
    this.touch(session);
    return true;
  }

  cancel(requestId: string): void {
    const session = this.sessions.get(requestId);
    if (!session) return;
    this.finish(session, { ok: false, status: "cancelled", detail: "cancelled by operator" });
  }

  pending(): { requestId: string; provider: ProviderId; phase: AuthPhase }[] {
    return [...this.sessions.values()].map(({ requestId, provider, phase }) => ({
      requestId,
      provider,
      phase,
    }));
  }

  shutdown(): void {
    for (const session of [...this.sessions.values()]) {
      this.finish(session, { ok: false, status: "cancelled", detail: "daemon shutting down" });
    }
  }

  // -------------------------------------------------------------------------

  private touch(session: Session): void {
    clearTimeout(session.idleTimer);
    session.idleTimer = setTimeout(
      () => this.finish(session, { ok: false, status: "expired", detail: "login went idle" }),
      this.idleTimeoutMs,
    );
  }

  private handleData(session: Session, chunk: string): void {
    session.buffer = `${session.buffer}${chunk}`.slice(-MAX_BUFFER);
    this.touch(session);

    if (!session.sawUrl) {
      const url = session.driver.matchUrl(chunk) ?? session.driver.matchUrl(session.buffer);
      if (url) {
        session.sawUrl = true;
        session.phase = "awaiting_code";
        clearTimeout(session.urlTimer);
        const code = session.driver.matchDisplayCode(session.buffer) ?? undefined;
        this.opts.onPrompt({
          requestId: session.requestId,
          provider: session.provider,
          kind: "url",
          url,
          code,
          instructions: code
            ? "Open this link and enter the code shown below to approve the sign-in."
            : "Open this link and approve the sign-in.",
        });
        return;
      }
    }

    if (session.driver.matchSuccess(session.buffer)) {
      this.finish(session, { ok: true, status: "authenticated" });
      return;
    }

    if (session.sawUrl && session.driver.matchCodePrompt(chunk)) {
      session.phase = "awaiting_code";
      this.opts.onPrompt({
        requestId: session.requestId,
        provider: session.provider,
        kind: "await_code",
        instructions: "The CLI is waiting for your code.",
      });
    }
  }

  /**
   * No URL matched in time. Rather than dead-ending the operator, show them
   * exactly what the CLI printed — a stale matcher must never be the reason
   * someone has to SSH to the box.
   */
  private failOpen(session: Session): void {
    if (session.sawUrl || !this.sessions.has(session.requestId)) return;
    this.opts.onPrompt({
      requestId: session.requestId,
      provider: session.provider,
      kind: "raw",
      instructions:
        "Could not recognise a verification link. Here is the CLI's raw output — follow it, then paste any code below.",
      tail: redactDetail(session.buffer.slice(-TAIL_CHARS)),
    });
  }

  private handleExit(session: Session, code: number): void {
    if (!this.sessions.has(session.requestId)) return;
    if (code === 0 || session.driver.matchSuccess(session.buffer)) {
      this.finish(session, { ok: true, status: "authenticated" });
      return;
    }
    const reason = session.driver.matchFailure(session.buffer);
    this.finish(session, {
      ok: false,
      status: "failed",
      detail: redactDetail(reason ?? `login exited with code ${code}`),
    });
  }

  private finish(session: Session, outcome: Omit<AuthResult, "requestId" | "provider">): void {
    if (!this.sessions.delete(session.requestId)) return;
    clearTimeout(session.urlTimer);
    clearTimeout(session.idleTimer);
    clearTimeout(session.hardTimer);
    session.phase = outcome.ok ? "done" : "failed";
    try {
      session.pty.kill();
    } catch {
      // Already gone; the result still needs to reach the operator.
    }
    this.opts.onResult({
      requestId: session.requestId,
      provider: session.provider,
      ...outcome,
    });
  }
}
