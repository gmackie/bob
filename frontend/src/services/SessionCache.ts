type SessionEntry = {
  claude?: string;
  directory?: string;
};

class SessionCache {
  private map = new Map<string, SessionEntry>(); // instanceId -> sessions

  get(instanceId: string): SessionEntry | undefined {
    return this.map.get(instanceId);
  }

  setClaude(instanceId: string, sessionId: string): void {
    const entry = this.map.get(instanceId) || {};
    entry.claude = sessionId;
    this.map.set(instanceId, entry);
  }

  setDirectory(instanceId: string, sessionId: string): void {
    const entry = this.map.get(instanceId) || {};
    entry.directory = sessionId;
    this.map.set(instanceId, entry);
  }

  clearClaude(instanceId: string): void {
    const entry = this.map.get(instanceId);
    if (!entry) return;
    delete entry.claude;
    if (!entry.directory) this.map.delete(instanceId); else this.map.set(instanceId, entry);
  }

  clearDirectory(instanceId: string): void {
    const entry = this.map.get(instanceId);
    if (!entry) return;
    delete entry.directory;
    if (!entry.claude) this.map.delete(instanceId); else this.map.set(instanceId, entry);
  }
}

export const sessionCache = new SessionCache();

