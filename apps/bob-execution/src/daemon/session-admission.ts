export class SessionAdmission {
  private readonly sessionIds = new Set<string>();

  constructor(private readonly capacity: number) {}

  get size(): number {
    return this.sessionIds.size;
  }

  reserve(sessionId: string): boolean {
    if (this.sessionIds.has(sessionId) || this.sessionIds.size >= this.capacity) return false;
    this.sessionIds.add(sessionId);
    return true;
  }

  release(sessionId: string): void {
    this.sessionIds.delete(sessionId);
  }
}
