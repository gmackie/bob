import { SessionManager } from "./SessionManager.js";

export interface CleanupConfig {
  idleTimeoutMs: number;
  staleLeaseTimeoutMs: number;
  maxSessionAgeMs: number;
  cleanupIntervalMs: number;
}

export interface CleanupCallbacks {
  getStaleSessionIds: (leaseExpiredBefore: Date) => Promise<string[]>;
  getIdleSessions: (idleSince: Date) => Promise<string[]>;
  getOldSessions: (createdBefore: Date) => Promise<string[]>;
  markSessionStopped: (sessionId: string) => Promise<void>;
  deleteOldEvents: (sessionId: string, keepAfterSeq: number) => Promise<number>;
}

export class SessionCleanup {
  private readonly config: CleanupConfig;
  private readonly sessionManager: SessionManager;
  private callbacks: CleanupCallbacks | null = null;
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;
  private isRunning = false;

  constructor(sessionManager: SessionManager, config?: Partial<CleanupConfig>) {
    this.sessionManager = sessionManager;
    this.config = {
      idleTimeoutMs: config?.idleTimeoutMs ?? 30 * 60 * 1000,
      staleLeaseTimeoutMs: config?.staleLeaseTimeoutMs ?? 60 * 1000,
      maxSessionAgeMs: config?.maxSessionAgeMs ?? 7 * 24 * 60 * 60 * 1000,
      cleanupIntervalMs: config?.cleanupIntervalMs ?? 60 * 1000,
    };
  }

  setCallbacks(callbacks: CleanupCallbacks): void {
    this.callbacks = callbacks;
  }

  start(): void {
    if (this.cleanupTimer) return;
    
    this.cleanupTimer = setInterval(() => {
      this.runCleanup().catch((error) => {
        console.error("[SessionCleanup] Cleanup error:", error);
      });
    }, this.config.cleanupIntervalMs);

    console.log("[SessionCleanup] Started with interval", this.config.cleanupIntervalMs, "ms");
  }

  stop(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    console.log("[SessionCleanup] Stopped");
  }

  async runCleanup(): Promise<CleanupStats> {
    if (this.isRunning) {
      return { staleSessions: 0, idleSessions: 0, oldSessions: 0, eventsDeleted: 0 };
    }

    this.isRunning = true;
    const stats: CleanupStats = {
      staleSessions: 0,
      idleSessions: 0,
      oldSessions: 0,
      eventsDeleted: 0,
    };

    try {
      if (this.callbacks) {
        stats.staleSessions = await this.cleanupStaleSessions();
        stats.idleSessions = await this.cleanupIdleSessions();
        stats.oldSessions = await this.cleanupOldSessions();
      }

      this.cleanupLocalSessions();

      if (stats.staleSessions + stats.idleSessions + stats.oldSessions > 0) {
        console.log("[SessionCleanup] Cleanup complete:", stats);
      }

      return stats;
    } finally {
      this.isRunning = false;
    }
  }

  private async cleanupStaleSessions(): Promise<number> {
    if (!this.callbacks) return 0;

    const expiredBefore = new Date(Date.now() - this.config.staleLeaseTimeoutMs);
    const staleIds = await this.callbacks.getStaleSessionIds(expiredBefore);

    for (const sessionId of staleIds) {
      try {
        await this.callbacks.markSessionStopped(sessionId);
        await this.sessionManager.removeSession(sessionId);
      } catch (error) {
        console.error(`[SessionCleanup] Failed to cleanup stale session ${sessionId}:`, error);
      }
    }

    return staleIds.length;
  }

  private async cleanupIdleSessions(): Promise<number> {
    if (!this.callbacks) return 0;

    const idleSince = new Date(Date.now() - this.config.idleTimeoutMs);
    const idleIds = await this.callbacks.getIdleSessions(idleSince);

    for (const sessionId of idleIds) {
      try {
        await this.callbacks.markSessionStopped(sessionId);
        await this.sessionManager.removeSession(sessionId);
      } catch (error) {
        console.error(`[SessionCleanup] Failed to cleanup idle session ${sessionId}:`, error);
      }
    }

    return idleIds.length;
  }

  private async cleanupOldSessions(): Promise<number> {
    if (!this.callbacks) return 0;

    const createdBefore = new Date(Date.now() - this.config.maxSessionAgeMs);
    const oldIds = await this.callbacks.getOldSessions(createdBefore);

    return oldIds.length;
  }

  private cleanupLocalSessions(): void {
    const sessions = this.sessionManager.getAllSessions();
    
    for (const session of sessions) {
      if (session.getSubscriberCount() === 0) {
        const status = session.getStatus();
        if (status === "stopped" || status === "error") {
          this.sessionManager.removeSession(session.sessionId).catch((error) => {
            console.error(`[SessionCleanup] Failed to remove local session ${session.sessionId}:`, error);
          });
        }
      }
    }
  }
}

export interface CleanupStats {
  staleSessions: number;
  idleSessions: number;
  oldSessions: number;
  eventsDeleted: number;
}
