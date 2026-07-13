import {
  appendFileSync,
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  statfsSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { join } from "node:path";

// =============================================================================
// EventBuffer — the runner's durable half of the envelope protocol.
//
// Every runner→gateway mutation (session_claimed, session_status,
// session_event) is assigned a monotonic per-session send-seq and journaled
// to disk BEFORE it is sent. The gateway acks each send-seq after it has
// transactionally persisted the frame; acks arrive in send order (the gateway
// serializes per-connection message handling), so ack(n) implies every m < n
// was persisted — the journal can be truncated through n.
//
// On gateway/DB outages the journal simply grows; on reconnect (or runner
// restart) unacked frames replay in order. Replay happens BEFORE any
// reconciliation so a completion that landed in the journal before a crash is
// never orphan-marked.
//
// Eviction: bounded per-session and host-wide. Only non-lifecycle frames
// (output chunks, tool chatter) are evicted, replaced by a single gap_marker
// per contiguous dropped span — lifecycle frames (status changes, errors,
// permission events) always survive, so the run's derived state survives any
// partition length.
//
// Durability: journal writes go through an open fd; lifecycle frames are
// fsync'd (survive power loss), output chunks are write-through only (survive
// process crash). Meta files are written via tmp+rename (atomic).
// =============================================================================

export interface BufferedFrame {
  sendSeq: number;
  frame: Record<string, unknown>;
}

interface SessionMeta {
  nextSendSeq: number;
  ackedSeq: number;
}

export interface EventBufferOptions {
  /** Per-session journal cap. Beyond this, non-lifecycle frames are evicted. */
  maxBytesPerSession?: number;
  /** Host-wide cap across all session journals. */
  maxTotalBytes?: number;
  /** Refuse non-lifecycle appends when the volume has less free space. */
  minFreeBytes?: number;
}

const LIFECYCLE_EVENT_TYPES = new Set([
  "state",
  "error",
  "permission_request",
  "permission_resolved",
  "status_change",
  "gap_marker",
  "pull_request",
]);

export function isLifecycleFrame(frame: Record<string, unknown>): boolean {
  if (frame.type === "session_status" || frame.type === "session_claimed") {
    return true;
  }
  if (frame.type === "session_event") {
    return LIFECYCLE_EVENT_TYPES.has(String(frame.eventType));
  }
  return false;
}

export class EventBuffer {
  private readonly dir: string;
  private readonly maxBytesPerSession: number;
  private readonly maxTotalBytes: number;
  private readonly minFreeBytes: number;

  private readonly meta = new Map<string, SessionMeta>();
  private readonly journalFds = new Map<string, number>();
  private readonly journalBytes = new Map<string, number>();

  constructor(dir: string, opts: EventBufferOptions = {}) {
    this.dir = dir;
    this.maxBytesPerSession = opts.maxBytesPerSession ?? 10 * 1024 * 1024;
    this.maxTotalBytes = opts.maxTotalBytes ?? 200 * 1024 * 1024;
    this.minFreeBytes = opts.minFreeBytes ?? 1024 * 1024 * 1024;
    mkdirSync(dir, { recursive: true });
    this.loadAll();
  }

  /** Sessions that still have unacked frames on disk (recovery + reconnect). */
  sessionsWithUnacked(): string[] {
    const out: string[] = [];
    for (const [sessionId, m] of this.meta) {
      if (m.ackedSeq < m.nextSendSeq - 1) out.push(sessionId);
    }
    return out;
  }

  /** Assign the next send-seq for a session and persist the counter. */
  assignSeq(sessionId: string): number {
    const m = this.getMeta(sessionId);
    const seq = m.nextSendSeq;
    m.nextSendSeq += 1;
    this.writeMeta(sessionId, m);
    return seq;
  }

  /** Journal a frame (which must already carry its sendSeq). */
  append(sessionId: string, sendSeq: number, frame: Record<string, unknown>): void {
    const lifecycle = isLifecycleFrame(frame);

    if (!lifecycle && !this.hasCapacity(sessionId)) {
      this.evict(sessionId);
      // After eviction we still append: a single frame is never larger than
      // the caps in practice, and dropping the newest frame would invert the
      // eviction policy (newest output is the most useful).
    }

    const line = `${JSON.stringify({ sendSeq, frame })}\n`;
    const fd = this.getJournalFd(sessionId);
    writeSync(fd, line);
    this.journalBytes.set(
      sessionId,
      (this.journalBytes.get(sessionId) ?? 0) + Buffer.byteLength(line),
    );
    if (lifecycle) {
      try {
        fsyncSync(fd);
      } catch {
        // fsync failure is not fatal — write-through already happened.
      }
    }
  }

  /**
   * Gateway acked sendSeq. Cumulative: everything <= sendSeq is durable on the
   * gateway, so advance the watermark. This intentionally tolerates seqs that
   * are never individually acked — session_claimed (the gateway handles but
   * does not ack it) and the seqs an eviction gap_marker collapses — which a
   * strict contiguous watermark would stall on forever. A frame the gateway
   * failed to PERSIST is not silently skipped either: it is the last unacked
   * frame until a later frame acks, and the terminal frame (usually last) stays
   * unacked with no successor, so it replays on reconnect; a lost middle status
   * frame is superseded by the next one. Journal compaction is lazy.
   */
  ack(sessionId: string, sendSeq: number): void {
    const m = this.getMeta(sessionId);
    if (sendSeq > m.ackedSeq) {
      m.ackedSeq = sendSeq;
      this.writeMeta(sessionId, m);
    }
  }

  /** True when every assigned seq has been acked. */
  fullyAcked(sessionId: string): boolean {
    const m = this.meta.get(sessionId);
    if (!m) return true;
    return m.ackedSeq >= m.nextSendSeq - 1;
  }

  /** Unacked frames in send order (replay input). */
  unacked(sessionId: string): BufferedFrame[] {
    const m = this.meta.get(sessionId);
    if (!m) return [];
    return this.readJournal(sessionId).filter((e) => e.sendSeq > m.ackedSeq);
  }

  /** Terminal + fully acked: delete the session's journal and meta. */
  releaseSession(sessionId: string): void {
    const fd = this.journalFds.get(sessionId);
    if (fd !== undefined) {
      try {
        closeSync(fd);
      } catch {
        /* already closed */
      }
      this.journalFds.delete(sessionId);
    }
    rmSync(this.journalPath(sessionId), { force: true });
    rmSync(this.metaPath(sessionId), { force: true });
    this.meta.delete(sessionId);
    this.journalBytes.delete(sessionId);
  }

  // ── internals ──────────────────────────────────────────────────────

  private loadAll(): void {
    for (const name of readdirSync(this.dir)) {
      if (!name.endsWith(".meta.json")) continue;
      const sessionId = name.slice(0, -".meta.json".length);
      try {
        const parsed = JSON.parse(
          readFileSync(join(this.dir, name), "utf8"),
        ) as SessionMeta;
        this.meta.set(sessionId, {
          nextSendSeq: parsed.nextSendSeq ?? 1,
          ackedSeq: parsed.ackedSeq ?? 0,
        });
        const jp = this.journalPath(sessionId);
        this.journalBytes.set(sessionId, existsSync(jp) ? statSync(jp).size : 0);
      } catch {
        // Corrupt meta: recover conservatively from the journal itself.
        const entries = this.readJournal(sessionId);
        const maxSeq = entries.reduce((a, e) => Math.max(a, e.sendSeq), 0);
        this.meta.set(sessionId, { nextSendSeq: maxSeq + 1, ackedSeq: 0 });
      }
    }
  }

  private getMeta(sessionId: string): SessionMeta {
    let m = this.meta.get(sessionId);
    if (!m) {
      m = { nextSendSeq: 1, ackedSeq: 0 };
      this.meta.set(sessionId, m);
    }
    return m;
  }

  private journalPath(sessionId: string): string {
    return join(this.dir, `${sessionId}.jsonl`);
  }

  private metaPath(sessionId: string): string {
    return join(this.dir, `${sessionId}.meta.json`);
  }

  private getJournalFd(sessionId: string): number {
    let fd = this.journalFds.get(sessionId);
    if (fd === undefined) {
      fd = openSync(this.journalPath(sessionId), "a");
      this.journalFds.set(sessionId, fd);
    }
    return fd;
  }

  private writeMeta(sessionId: string, m: SessionMeta): void {
    const tmp = `${this.metaPath(sessionId)}.tmp`;
    writeFileSync(tmp, JSON.stringify(m));
    renameSync(tmp, this.metaPath(sessionId));
  }

  private readJournal(sessionId: string): BufferedFrame[] {
    const path = this.journalPath(sessionId);
    if (!existsSync(path)) return [];
    const out: BufferedFrame[] = [];
    for (const line of readFileSync(path, "utf8").split("\n")) {
      if (!line.trim()) continue;
      try {
        const parsed = JSON.parse(line) as BufferedFrame;
        if (typeof parsed.sendSeq === "number" && parsed.frame) out.push(parsed);
      } catch {
        // A torn trailing line (crash mid-write) is expected; skip it. The
        // frame it belonged to was never sent, and its seq will be reused
        // only if the meta write also didn't land — in which case the
        // gateway's (sessionId, sendSeq) unique index dedups any overlap.
      }
    }
    return out;
  }

  private totalBytes(): number {
    let total = 0;
    for (const b of this.journalBytes.values()) total += b;
    return total;
  }

  private hasCapacity(sessionId: string): boolean {
    if ((this.journalBytes.get(sessionId) ?? 0) >= this.maxBytesPerSession) {
      return false;
    }
    if (this.totalBytes() >= this.maxTotalBytes) return false;
    try {
      const s = statfsSync(this.dir);
      if (s.bavail * s.bsize < this.minFreeBytes) return false;
    } catch {
      // statfs unavailable: skip the free-space check rather than blocking.
    }
    return true;
  }

  /**
   * Rewrite a session's journal keeping lifecycle frames and dropping
   * non-lifecycle ones, replacing each contiguous dropped span with one
   * gap_marker frame carrying the first dropped seq (so replay ordering and
   * ingest dedup keep working) and the span size.
   */
  private evict(sessionId: string): void {
    const entries = this.readJournal(sessionId);
    const kept: BufferedFrame[] = [];
    let spanStart: number | null = null;
    let spanCount = 0;
    let spanEnd = 0;

    const flushSpan = () => {
      if (spanStart === null) return;
      kept.push({
        sendSeq: spanStart,
        frame: {
          type: "session_event",
          sessionId,
          eventType: "gap_marker",
          direction: "system",
          payload: { droppedCount: spanCount, droppedThroughSeq: spanEnd },
          sendSeq: spanStart,
        },
      });
      spanStart = null;
      spanCount = 0;
    };

    for (const entry of entries) {
      if (isLifecycleFrame(entry.frame)) {
        flushSpan();
        kept.push(entry);
      } else {
        if (spanStart === null) spanStart = entry.sendSeq;
        spanCount += 1;
        spanEnd = entry.sendSeq;
      }
    }
    flushSpan();

    const fd = this.journalFds.get(sessionId);
    if (fd !== undefined) {
      try {
        closeSync(fd);
      } catch {
        /* ignore */
      }
      this.journalFds.delete(sessionId);
    }

    const tmp = `${this.journalPath(sessionId)}.tmp`;
    writeFileSync(tmp, kept.map((e) => JSON.stringify(e)).join("\n") + (kept.length ? "\n" : ""));
    renameSync(tmp, this.journalPath(sessionId));
    this.journalBytes.set(sessionId, statSync(this.journalPath(sessionId)).size);
  }
}
