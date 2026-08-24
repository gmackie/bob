/**
 * Worktree watcher: turns an agent's edits into a `file_changes` session
 * event every ~2 s so the cockpit can show file heat, +/- lines and (V2) the
 * repo animation while the agent works — instead of learning about a change
 * only when the PR opens.
 *
 * fs.watch (recursive) on the session worktree; paths are batched and
 * de-duplicated per window, noisy dirs are ignored, and each batch is
 * enriched with `git diff --numstat` against the base branch plus the last
 * commit subject. Everything here is best-effort: a watcher error degrades to
 * no events, never to a failed session.
 */
import { openSync, closeSync, readSync, statSync, watch, type FSWatcher } from "node:fs";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { parseCheckEventLine, type CheckEvent } from "@forgegraph/check-events";

const execFileAsync = promisify(execFile);

/**
 * Where check-events land. The bob-check shim pins FG_CHECK_EVENTS_PATH to the
 * legacy `.bob/` file; anything using @forgegraph/check-events directly (the
 * vitest/jest reporters, a bare `fg-check`) writes the package default `.fg/`.
 * Tail both so every producer streams.
 */
export const CHECK_EVENT_FILES = [".bob/check-events.ndjson", ".fg/check-events.ndjson"] as const;

export const IGNORED_SEGMENTS = new Set([
  "node_modules",
  ".git",
  ".turbo",
  ".next",
  "dist",
  "build",
  "out",
  "coverage",
  ".cache",
  ".pnpm-store",
  "target",
  "__pycache__",
  ".venv",
  ".bob", // runner-internal (check events, shims) — never "file heat"
  ".fg", // @forgegraph/check-events default events dir
]);

export interface NumstatEntry {
  path: string;
  added: number;
  removed: number;
}

export interface FileChangesPayload {
  /** Paths touched in this batch (relative to the worktree), hottest first. */
  touched: string[];
  /** Cumulative diff vs base, from git. */
  files: number;
  added: number;
  removed: number;
  topFiles: NumstatEntry[];
  lastCommit: string | null;
  branch: string;
  baseBranch: string;
}

/** Should a changed path be reported at all? */
export function isInteresting(relPath: string): boolean {
  if (!relPath || relPath.startsWith("..")) return false;
  return !relPath.split(/[\\/]/).some((seg) => IGNORED_SEGMENTS.has(seg) || seg.endsWith(".swp") || seg.endsWith("~"));
}

/** Parse `git diff --numstat` output. Binary files show "-" and count as 0. */
export function parseNumstat(out: string): NumstatEntry[] {
  const rows: NumstatEntry[] = [];
  for (const line of out.split("\n")) {
    const m = /^(\S+)\t(\S+)\t(.+)$/.exec(line.trim());
    if (!m) continue;
    rows.push({
      added: m[1] === "-" ? 0 : Number(m[1]),
      removed: m[2] === "-" ? 0 : Number(m[2]),
      path: m[3]!,
    });
  }
  return rows;
}

/** Rank touched paths: most recently touched first, then most often. */
export function rankTouched(counts: Map<string, { n: number; last: number }>): string[] {
  return [...counts.entries()]
    .sort((a, b) => b[1].last - a[1].last || b[1].n - a[1].n)
    .map(([p]) => p)
    .slice(0, 40);
}

export interface WorktreeWatchOptions {
  path: string;
  branch: string;
  baseBranch: string;
  intervalMs?: number;
  emit: (payload: FileChangesPayload) => void;
  /**
   * check-events (v2 envelope; v1 bob-check lines are upgraded on parse)
   * tailed from the worktree's events files — see CHECK_EVENT_FILES.
   */
  emitCheck?: (event: CheckEvent) => void;
  log?: (msg: string) => void;
}

export interface WorktreeWatchHandle {
  /** Stop watching (drains any check events written since the last tick first). */
  stop: () => void;
  /** Read newly appended check events now, ahead of the next tick. */
  drainChecks: () => void;
}

/** Start watching; returns a handle. Never throws. */
export function watchWorktree(opts: WorktreeWatchOptions): WorktreeWatchHandle {
  const interval = opts.intervalMs ?? 2000;
  const pending = new Map<string, { n: number; last: number }>();
  let watcher: FSWatcher | null = null;
  let timer: NodeJS.Timeout | null = null;
  let flushing = false;
  let stopped = false;

  // Tail the check-events files regardless of fs events — cheap stat per
  // tick, read only the new bytes, carry a partial trailing line until its
  // newline arrives, and reset on truncation/recreation.
  const tails = CHECK_EVENT_FILES.map((rel) => ({ path: join(opts.path, rel), offset: 0, carry: "" }));
  const drainCheckEvents = () => {
    if (!opts.emitCheck) return;
    for (const t of tails) {
      try {
        const size = statSync(t.path).size;
        if (size < t.offset) {
          t.offset = 0;
          t.carry = "";
        }
        if (size === t.offset) continue;
        const fd = openSync(t.path, "r");
        const buf = Buffer.alloc(size - t.offset);
        readSync(fd, buf, 0, buf.length, t.offset);
        closeSync(fd);
        t.offset = size;
        const text = t.carry + buf.toString("utf8");
        const lines = text.split("\n");
        t.carry = lines.pop() ?? "";
        for (const line of lines) {
          const event = parseCheckEventLine(line);
          if (event) opts.emitCheck(event);
        }
      } catch {
        /* file absent until the agent first runs a check */
      }
    }
  };

  const flush = async () => {
    drainCheckEvents();
    if (flushing || stopped || pending.size === 0) return;
    flushing = true;
    const touched = rankTouched(pending);
    pending.clear();
    try {
      const [numstat, last] = await Promise.all([
        execFileAsync("git", ["diff", "--numstat", `${opts.baseBranch}...HEAD`], { cwd: opts.path, timeout: 5000 })
          .then((r) => r.stdout)
          .catch(() => ""),
        execFileAsync("git", ["log", "-1", "--format=%s"], { cwd: opts.path, timeout: 5000 })
          .then((r) => r.stdout.trim() || null)
          .catch(() => null),
      ]);
      // Uncommitted edits: add the working-tree diff on top of committed ahead-of-base.
      const wt = await execFileAsync("git", ["diff", "--numstat"], { cwd: opts.path, timeout: 5000 })
        .then((r) => r.stdout)
        .catch(() => "");
      const merged = new Map<string, NumstatEntry>();
      for (const e of [...parseNumstat(numstat), ...parseNumstat(wt)]) {
        const cur = merged.get(e.path);
        merged.set(e.path, cur ? { path: e.path, added: cur.added + e.added, removed: cur.removed + e.removed } : e);
      }
      const entries = [...merged.values()].sort((a, b) => b.added + b.removed - (a.added + a.removed));
      opts.emit({
        touched,
        files: entries.length,
        added: entries.reduce((n, e) => n + e.added, 0),
        removed: entries.reduce((n, e) => n + e.removed, 0),
        topFiles: entries.slice(0, 12),
        lastCommit: last,
        branch: opts.branch,
        baseBranch: opts.baseBranch,
      });
    } catch (err) {
      opts.log?.(`[worktree-watch] flush failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      flushing = false;
    }
  };

  try {
    watcher = watch(opts.path, { recursive: true }, (_event, filename) => {
      if (!filename) return;
      const rel = filename.toString();
      if (!isInteresting(rel)) return;
      const cur = pending.get(rel);
      pending.set(rel, { n: (cur?.n ?? 0) + 1, last: Date.now() });
    });
    watcher.on("error", (err) => {
      opts.log?.(`[worktree-watch] watcher error (file events off for this session): ${err.message}`);
    });
    timer = setInterval(() => void flush(), interval);
  } catch (err) {
    opts.log?.(`[worktree-watch] could not start: ${err instanceof Error ? err.message : String(err)}`);
  }

  return {
    drainChecks: drainCheckEvents,
    stop: () => {
      drainCheckEvents();
      stopped = true;
      if (timer) clearInterval(timer);
      try {
        watcher?.close();
      } catch {
        /* ignore */
      }
    },
  };
}
