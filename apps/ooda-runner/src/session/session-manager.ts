import { randomUUID } from "node:crypto";

export type SessionStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

export interface SessionInput {
  threadId: string;
  adapterId: string;
  toolProfileId: string;
  sourceBundleIds: string[];
  workspaceRoot: string;
}

export interface SessionRecord extends SessionInput {
  id: string;
  status: SessionStatus;
  createdAt: string;
  updatedAt: string;
}

export class SessionManager {
  private sessions = new Map<string, SessionRecord>();

  createSession(input: SessionInput): SessionRecord {
    const now = new Date().toISOString();
    const record: SessionRecord = {
      id: randomUUID(),
      status: "pending",
      createdAt: now,
      updatedAt: now,
      ...input,
    };
    this.sessions.set(record.id, record);
    return record;
  }

  getSession(id: string): SessionRecord | undefined {
    return this.sessions.get(id);
  }

  listSessions(): SessionRecord[] {
    return [...this.sessions.values()];
  }

  updateStatus(id: string, status: SessionStatus): void {
    const session = this.sessions.get(id);
    if (!session) {
      throw new Error(`Session not found: ${id}`);
    }
    session.status = status;
    session.updatedAt = new Date().toISOString();
  }
}
