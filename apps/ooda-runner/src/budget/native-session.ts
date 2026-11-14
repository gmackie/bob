/**
 * BOB-76: the agent CLI's own session id, read from its first stream-json
 * lines. The inference proxy reports usage under that id (verified against
 * production on 2026-11-14: a Claude Code session's id appears verbatim as the
 * usage record's session_id), so linking it to the Bob session is what turns
 * the token ledger into a cost per run and per work item.
 *
 * - Claude: {"type":"system","subtype":"init","session_id":"…"}
 * - Codex:  {"type":"thread.started","thread_id":"…"}
 */

const SCAN_LIMIT = 64 * 1024;
const ID = /^[A-Za-z0-9-]{8,128}$/;

export function nativeSessionIdFromLine(line: string): string | undefined {
  const trimmed = line.trim();
  if (!trimmed.startsWith("{") || !trimmed.includes("session") && !trimmed.includes("thread")) return undefined;
  try {
    const event = JSON.parse(trimmed) as { type?: unknown; session_id?: unknown; thread_id?: unknown };
    const id =
      event.type === "system" && typeof event.session_id === "string"
        ? event.session_id
        : event.type === "thread.started" && typeof event.thread_id === "string"
          ? event.thread_id
          : undefined;
    return id && ID.test(id) ? id : undefined;
  } catch {
    return undefined;
  }
}

/** Feeds output chunks per run; reports each run's native id once. */
export class NativeSessionTracker {
  private readonly pending = new Map<string, string>();
  private readonly found = new Set<string>();

  constructor(private readonly onFound: (runSessionId: string, nativeSessionId: string) => void) {}

  feed(runSessionId: string, chunk: string): void {
    if (this.found.has(runSessionId)) return;
    const buffer = `${this.pending.get(runSessionId) ?? ""}${chunk}`;
    const lines = buffer.split("\n");
    const tail = lines.pop() ?? "";
    for (const line of lines) {
      const id = nativeSessionIdFromLine(line);
      if (id) {
        this.found.add(runSessionId);
        this.pending.delete(runSessionId);
        this.onFound(runSessionId, id);
        return;
      }
    }
    if (buffer.length > SCAN_LIMIT) {
      // Long enough that the CLI is not going to announce an id; stop scanning.
      this.found.add(runSessionId);
      this.pending.delete(runSessionId);
      return;
    }
    this.pending.set(runSessionId, tail);
  }

  forget(runSessionId: string): void {
    this.pending.delete(runSessionId);
    this.found.delete(runSessionId);
  }
}
