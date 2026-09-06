import { closeSync, existsSync, mkdirSync, openSync, readSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

export interface JournalFrame extends Record<string, unknown> {
  sessionId: string;
  sendSeq: number;
}
export interface ProcessIdentity {
  pid: number;
  fingerprint: string;
}
/** SQLite owns frame/counter/lifecycle atomicity; a separate exclusive DB lock
 * protects the single producer across crashes without stale-lock reclamation. */
export class DurableJournal {
  private readonly owner: DatabaseSync;
  private readonly db: DatabaseSync;
  private failed = false;
  constructor(
    dir: string,
    private readonly maxBytes = 64 * 1024 * 1024,
  ) {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    this.owner = new DatabaseSync(join(dir, "owner.sqlite"));
    try {
      this.owner.exec("PRAGMA busy_timeout=0; BEGIN EXCLUSIVE;");
    } catch (error) {
      this.owner.close();
      throw new Error("Journal already owned by another process", {
        cause: error,
      });
    }
    try {
      const path = join(dir, "journal.sqlite");
      if (existsSync(path)) {
        const fd = openSync(path, "r");
        const header = Buffer.alloc(16);
        try {
          readSync(fd, header, 0, 16, 0);
        } finally {
          closeSync(fd);
        }
        if (header.toString() !== "SQLite format 3\0")
          throw Error("Invalid journal database");
      }
      this.db = new DatabaseSync(path);
      this.db
        .exec(`PRAGMA busy_timeout=1000; PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL; PRAGMA fullfsync=ON;
    CREATE TABLE IF NOT EXISTS counters(sessionId TEXT PRIMARY KEY, value INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS frames(sessionId TEXT NOT NULL, sendSeq INTEGER NOT NULL, body TEXT NOT NULL, bytes INTEGER NOT NULL, PRIMARY KEY(sessionId,sendSeq));
    CREATE TABLE IF NOT EXISTS active(sessionId TEXT PRIMARY KEY, process TEXT);
    CREATE TABLE IF NOT EXISTS completed(sessionId TEXT PRIMARY KEY);`);
      if (
        this.db
          .prepare(
            "SELECT 1 FROM counters WHERE value < 0 OR typeof(value) != 'integer' UNION ALL SELECT 1 FROM frames f LEFT JOIN counters c USING(sessionId) WHERE c.value IS NULL OR c.value < f.sendSeq OR f.sendSeq < 1 LIMIT 1",
          )
          .get()
      )
        throw Error("Invalid journal counters");
      this.pending();
    } catch (error) {
      this.owner.close();
      throw error;
    }
  }
  private transaction<T>(operation: () => T): T {
    if (this.failed) throw Error("Journal storage failed; restart required");
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = operation();
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      try {
        this.db.exec("ROLLBACK");
      } catch {
        /* original error retained */
      }
      this.failed = true;
      throw error;
    }
  }
  append(frame: Record<string, unknown> & { sessionId: string }): JournalFrame {
    const counter = this.db
      .prepare("SELECT value FROM counters WHERE sessionId=?")
      .get(frame.sessionId);
    const sendSeq = Number(counter?.value ?? 0) + 1;
    if (
      !counter &&
      Number(
        this.db.prepare("SELECT count(*) AS n FROM counters").get()?.n ?? 0,
      ) >= 100000
    )
      throw Error("Journal session capacity exhausted");
    if (!Number.isSafeInteger(sendSeq))
      throw Error("Journal sequence exhausted");
    const envelope = { ...frame, sendSeq };
    const body = JSON.stringify(envelope);
    const bytes = Buffer.byteLength(body);
    const terminal =
      frame.type === "session_status" &&
      ["completed", "error", "interrupted"].includes(String(frame.status));
    const limit = terminal
      ? this.maxBytes
      : this.maxBytes - Math.min(1024 * 1024, Math.floor(this.maxBytes / 4));
    const used = Number(
      this.db
        .prepare("SELECT coalesce(sum(bytes),0) AS total FROM frames")
        .get()?.total ?? 0,
    );
    if (used + bytes > limit) throw Error("Journal capacity exhausted");
    return this.transaction(() => {
      this.db
        .prepare(
          "INSERT INTO counters VALUES(?,?) ON CONFLICT(sessionId) DO UPDATE SET value=excluded.value",
        )
        .run(frame.sessionId, sendSeq);
      this.db
        .prepare("INSERT INTO frames VALUES(?,?,?,?)")
        .run(frame.sessionId, sendSeq, body, bytes);
      if (terminal)
        this.db
          .prepare("INSERT INTO completed VALUES(?) ON CONFLICT DO NOTHING")
          .run(frame.sessionId);
      if (frame.type === "session_status") {
        if (terminal)
          this.db
            .prepare("DELETE FROM active WHERE sessionId=?")
            .run(frame.sessionId);
        else
          this.db
            .prepare(
              "INSERT INTO active(sessionId) VALUES(?) ON CONFLICT DO NOTHING",
            )
            .run(frame.sessionId);
      }
      return envelope;
    });
  }
  hasCompleted(sessionId: string): boolean {
    return Boolean(
      this.db
        .prepare("SELECT 1 FROM completed WHERE sessionId=?")
        .get(sessionId),
    );
  }
  setProcess(sessionId: string, identity: ProcessIdentity): void {
    this.transaction(() => {
      if (
        this.db
          .prepare("UPDATE active SET process=? WHERE sessionId=?")
          .run(JSON.stringify(identity), sessionId).changes !== 1
      )
        throw Error("Unknown active execution");
    });
  }
  activeSessions(): {
    sessionId: string;
    process: ProcessIdentity | null;
  }[] {
    return this.db
      .prepare("SELECT sessionId,process FROM active")
      .all()
      .map((row) => {
        const process =
          row.process === null
            ? null
            : (JSON.parse(String(row.process)) as ProcessIdentity);
        if (
          process &&
          (!Number.isSafeInteger(process.pid) ||
            process.pid < 1 ||
            typeof process.fingerprint !== "string" ||
            !process.fingerprint)
        )
          throw Error("Invalid process identity");
        return { sessionId: String(row.sessionId), process };
      });
  }
  ack(sessionId: string, sendSeq: number): void {
    this.transaction(() => {
      this.db
        .prepare("DELETE FROM frames WHERE sessionId=? AND sendSeq=?")
        .run(sessionId, sendSeq);
    });
  }
  pending(): JournalFrame[] {
    return this.db
      .prepare("SELECT sessionId,sendSeq,body FROM frames ORDER BY rowid")
      .all()
      .map((row) => {
        const frame = JSON.parse(String(row.body)) as JournalFrame;
        if (frame.sessionId !== row.sessionId || frame.sendSeq !== row.sendSeq)
          throw Error("Invalid journal frame");
        return frame;
      });
  }
  close(): void {
    this.db.close();
    this.owner.close();
  }
}
