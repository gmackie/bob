import { SessionActor, SessionConfig, PersistenceCallback } from "./SessionActor.js";
import type { SessionStatus } from "../ws/protocol.js";

export interface SessionManagerConfig {
  gatewayId: string;
  leaseTimeoutMs?: number;
  cleanupIntervalMs?: number;
}

export interface SessionRecord {
  id: string;
  userId: string;
  status: SessionStatus;
  agentType: string;
  workingDirectory: string;
  worktreeId?: string;
  repositoryId?: string;
  nextSeq: number;
  claimedByGatewayId?: string;
  leaseExpiresAt?: Date;
}

export interface SessionManagerCallbacks {
  onPersistEvent: PersistenceCallback;
  onSessionStatusChange: (sessionId: string, status: SessionStatus) => Promise<void>;
  loadSession: (sessionId: string) => Promise<SessionRecord | null>;
  createSession: (config: Omit<SessionConfig, "sessionId">) => Promise<SessionRecord>;
  updateSessionLease: (sessionId: string, gatewayId: string, expiresAt: Date) => Promise<void>;
  releaseSessionLease: (sessionId: string) => Promise<void>;
}

export class SessionManager {
  private readonly gatewayId: string;
  private readonly leaseTimeoutMs: number;
  private readonly cleanupIntervalMs: number;
  private readonly sessions = new Map<string, SessionActor>();
  private callbacks: SessionManagerCallbacks | null = null;
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  constructor(config: SessionManagerConfig) {
    this.gatewayId = config.gatewayId;
    this.leaseTimeoutMs = config.leaseTimeoutMs ?? 30_000;
    this.cleanupIntervalMs = config.cleanupIntervalMs ?? 10_000;
  }

  setCallbacks(callbacks: SessionManagerCallbacks): void {
    this.callbacks = callbacks;
  }

  start(): void {
    this.cleanupTimer = setInterval(() => this.refreshLeases(), this.cleanupIntervalMs);
  }

  stop(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }

    for (const session of this.sessions.values()) {
      session.destroy();
    }
    this.sessions.clear();
  }

  async getOrLoadSession(sessionId: string): Promise<SessionActor | null> {
    let actor = this.sessions.get(sessionId);
    if (actor) {
      return actor;
    }

    if (!this.callbacks) {
      return null;
    }

    const record = await this.callbacks.loadSession(sessionId);
    if (!record) {
      return null;
    }

    actor = new SessionActor({
      sessionId: record.id,
      userId: record.userId,
      agentType: record.agentType,
      workingDirectory: record.workingDirectory,
      worktreeId: record.worktreeId,
      repositoryId: record.repositoryId,
    });

    actor.setPersistenceCallback((event) => {
      this.callbacks?.onPersistEvent(event);
    });

    actor.setStatusChangeCallback((status) => {
      this.callbacks?.onSessionStatusChange(sessionId, status);
    });

    this.sessions.set(sessionId, actor);

    await this.claimLease(sessionId);

    return actor;
  }

  async createSession(config: Omit<SessionConfig, "sessionId">): Promise<SessionActor> {
    if (!this.callbacks) {
      throw new Error("SessionManager callbacks not configured");
    }

    const record = await this.callbacks.createSession(config);

    const actor = new SessionActor({
      sessionId: record.id,
      userId: record.userId,
      agentType: record.agentType,
      workingDirectory: record.workingDirectory,
      worktreeId: record.worktreeId,
      repositoryId: record.repositoryId,
    });

    actor.setPersistenceCallback((event) => {
      this.callbacks?.onPersistEvent(event);
    });

    actor.setStatusChangeCallback((status) => {
      this.callbacks?.onSessionStatusChange(record.id, status);
    });

    this.sessions.set(record.id, actor);

    await this.claimLease(record.id);

    return actor;
  }

  getSession(sessionId: string): SessionActor | undefined {
    return this.sessions.get(sessionId);
  }

  hasSession(sessionId: string): boolean {
    return this.sessions.has(sessionId);
  }

  async removeSession(sessionId: string): Promise<void> {
    const actor = this.sessions.get(sessionId);
    if (actor) {
      actor.destroy();
      this.sessions.delete(sessionId);
      await this.callbacks?.releaseSessionLease(sessionId);
    }
  }

  getSessionCount(): number {
    return this.sessions.size;
  }

  getAllSessions(): SessionActor[] {
    return Array.from(this.sessions.values());
  }

  getSessionsForUser(userId: string): SessionActor[] {
    return this.getAllSessions().filter((s) => s.userId === userId);
  }

  private async claimLease(sessionId: string): Promise<void> {
    if (!this.callbacks) return;

    const expiresAt = new Date(Date.now() + this.leaseTimeoutMs);
    await this.callbacks.updateSessionLease(sessionId, this.gatewayId, expiresAt);
  }

  private async refreshLeases(): Promise<void> {
    if (!this.callbacks) return;

    const expiresAt = new Date(Date.now() + this.leaseTimeoutMs);
    
    for (const sessionId of this.sessions.keys()) {
      try {
        await this.callbacks.updateSessionLease(sessionId, this.gatewayId, expiresAt);
      } catch (error) {
        console.error(`[SessionManager] Failed to refresh lease for ${sessionId}:`, error);
      }
    }
  }

  getInfo(): {
    gatewayId: string;
    sessionCount: number;
    sessions: Array<{
      sessionId: string;
      userId: string;
      status: string;
      subscriberCount: number;
    }>;
  } {
    return {
      gatewayId: this.gatewayId,
      sessionCount: this.sessions.size,
      sessions: this.getAllSessions().map((s) => ({
        sessionId: s.sessionId,
        userId: s.userId,
        status: s.getStatus(),
        subscriberCount: s.getSubscriberCount(),
      })),
    };
  }
}
