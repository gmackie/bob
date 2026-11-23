import type { CiMessage, CiPhase, TailFrame } from "@bob/sdlc-view";

import type { Beat } from "./beat";

/**
 * Beats from the attempt stream (BOB-91 slice 3): the live tail and CI messages the edge
 * sends for watched items. The SDLC edge only moves when the coordinator does; these move
 * while an agent works, so the floor and desks can react to real work between transitions.
 *
 * Same rules as sdlcBeats: pure, replay-safe ids, and the first frame (or a new attempt,
 * or a new CI sha) is a baseline, never an event.
 */

/** What a tail line says the agent did. Only shell commands are classified. */
export type AgentAction = "test" | "build" | "lint" | "typecheck" | "install" | "commit" | "push" | "git" | "command";

export interface TailLine {
  action: AgentAction;
  /** The command's exit code once it finished, else null (still running, or not reported). */
  exit: number | null;
}

const COMMAND = /^\$ (.*?)(?: \(exit (-?\d+)\))?$/;
// Order matters: the first matching rule wins. Git comes first so a commit message that
// mentions "lint" stays a commit; "pnpm test:types" is a typecheck, not a test.
const RULES: readonly [AgentAction, RegExp][] = [
  ["push", /^git( -\S+)* push\b/],
  ["commit", /^git( -\S+)* commit\b/],
  ["git", /^(git|jj|gh)\b/],
  ["typecheck", /\b(tsc|typecheck|test:types|check-types|mypy|pyright)\b/],
  ["lint", /\b(lint|eslint|biome|prettier|ruff|oxlint)\b/],
  ["test", /\b(vitest|jest|pytest|test|tests|spec)\b/],
  ["build", /\b(build|compile|bundle)\b/],
];

/** Classifies one tail line, or null when it is not a shell command (prose, reasoning). */
export function classifyLine(line: string): TailLine | null {
  const m = COMMAND.exec(line);
  if (!m) return null;
  const cmd = m[1]!.trim();
  const exit = m[2] === undefined ? null : Number(m[2]);
  // Package-manager installs are matched on the manager word, so "pnpm test" stays a test.
  const install = /^(pnpm|npm|yarn|bun|uv|pip3?)\s+(i|install|add|ci|sync)\b/.test(cmd);
  const action = install ? "install" : RULES.find(([, re]) => re.test(cmd))?.[0] ?? "command";
  return { action, exit };
}

/**
 * The lines of `next` that `prev` had not shown, oldest first. A frame carries the whole
 * (40-line) tail, so the window slides; the longest suffix of prev that starts next is the
 * overlap. A command line that gained its "(exit N)" counts as new (the command finished).
 * With no overlap at all, the newest `cap` lines count.
 */
export function newTailLines(prev: readonly string[], next: readonly string[], cap = 8): string[] {
  for (let drop = 0; drop < prev.length; drop++) {
    const keep = prev.length - drop;
    if (keep > next.length) continue;
    let ok = true;
    for (let i = 0; i < keep - 1 && ok; i++) ok = prev[drop + i] === next[i];
    if (!ok) continue;
    const was = prev[prev.length - 1]!;
    const now = next[keep - 1]!;
    if (was === now) return next.slice(keep);
    if (finishedInPlace(was, now)) return next.slice(keep - 1);
  }
  return next.slice(-cap);
}

/** "$ pnpm test" became "$ pnpm test (exit 0)": the same command, now finished. */
const finishedInPlace = (was: string, now: string) => now.startsWith(was) && classifyLine(was)?.exit === null && classifyLine(now)?.exit != null;

const frameAt = (f: TailFrame) => {
  const t = Date.parse(f.at);
  return Number.isFinite(t) ? t : 0;
};

/**
 * Beats between two tail frames of one item. One agent.activity beat when any line arrived
 * (ambient motion, never text), plus one agent.action beat per classified command line.
 */
export function tailBeats(prev: TailFrame | undefined, next: TailFrame, issue?: string): Beat[] {
  if (!prev || prev.attemptId !== next.attemptId || prev.itemId !== next.itemId || next.at <= prev.at) return [];
  const fresh = newTailLines(prev.lines, next.lines);
  if (!fresh.length) return [];
  const at = frameAt(next);
  const base = `tail:${next.attemptId}:${next.at}`;
  const subject = { itemId: next.itemId, ...(issue ? { issue } : {}) };
  const beat = (suffix: string, kind: Beat["kind"], data: Beat["data"]): Beat => ({ id: `${base}:${suffix}`, source: "session", epoch: next.attemptId, seq: at, at, kind, subject, data });
  const out: Beat[] = [beat("activity", "agent.activity", { lines: fresh.length, thread: next.threadStatus })];
  fresh.forEach((line, i) => {
    const c = classifyLine(line);
    // Unfinished plain commands are just activity; finished ones and named actions are beats.
    if (!c || (c.action === "command" && c.exit === null)) return;
    out.push(beat(`${i}`, "agent.action", { action: c.action, exit: c.exit, line: line.slice(0, 120) }));
  });
  return out;
}

const SETTLED = new Set<CiPhase["status"]>(["passed", "skipped"]);
const green = (phases: readonly CiPhase[]) => phases.length > 0 && phases.every((p) => SETTLED.has(p.status));

/**
 * Beats between two CI messages of one item: one ci.phase beat per phase whose status
 * changed (started, passed, failed), and ci.green when the whole run turns green. A new
 * sha is a new run: a baseline, like a first message.
 */
export function ciBeats(prev: CiMessage | undefined, next: CiMessage, issue?: string): Beat[] {
  if (!prev || !prev.available || !next.available || prev.sha !== next.sha || next.at <= prev.at) return [];
  const t = Date.parse(next.at);
  const at = Number.isFinite(t) ? t : 0;
  const before = new Map(prev.phases.map((p) => [p.name, p.status] as const));
  const subject = { itemId: next.itemId, sha: next.sha, ...(issue ? { issue } : {}) };
  const out: Beat[] = [];
  for (const phase of next.phases) {
    const from = before.get(phase.name) ?? null;
    if (from === phase.status) continue;
    out.push({ id: `ci:${next.sha}:${phase.name}:${phase.status}`, source: "forgegraph", epoch: next.sha, seq: at, at, kind: "ci.phase", subject, data: { phase: phase.name, from, to: phase.status } });
  }
  if (green(next.phases) && !green(prev.phases)) {
    out.push({ id: `ci:${next.sha}:green`, source: "forgegraph", epoch: next.sha, seq: at, at, kind: "ci.green", subject, data: { phases: next.phases.length } });
  }
  return out;
}

/** Progress through a CI run, 0..1, for a meter: settled or failed phases over all phases. */
export function ciProgress(phases: readonly CiPhase[]): number {
  if (!phases.length) return 0;
  const done = phases.filter((p) => p.status === "passed" || p.status === "skipped" || p.status === "failed").length;
  return done / phases.length;
}

/** What a client keeps per watched item; DeskDetail and the phone's AttemptDetail both fit. */
export interface AttemptDetailLike {
  tail?: TailFrame | null;
  ci?: CiMessage | null;
}

/**
 * Beats between two per-item detail records (watched items only), in item order. An item
 * new to the record is a baseline, like a first frame. `issue` labels the beats ("BOB-91").
 */
export function attemptBeats(
  prev: Readonly<Record<string, AttemptDetailLike | undefined>>,
  next: Readonly<Record<string, AttemptDetailLike | undefined>>,
  issue: (itemId: string) => string | undefined = () => undefined,
): Beat[] {
  const out: Beat[] = [];
  for (const id of Object.keys(next).sort()) {
    const a = prev[id];
    const b = next[id];
    if (!a || !b || a === b) continue;
    if (b.tail && a.tail !== b.tail) out.push(...tailBeats(a.tail ?? undefined, b.tail, issue(id)));
    if (b.ci && a.ci !== b.ci) out.push(...ciBeats(a.ci ?? undefined, b.ci, issue(id)));
  }
  return out;
}

/** Last agent activity per item from a batch of beats (epoch ms): drives "typing" parcels. */
export function activityAt(beats: readonly Beat[], at: number): Record<string, number> {
  const out: Record<string, number> = {};
  for (const b of beats) if (b.kind === "agent.activity" && b.subject.itemId) out[b.subject.itemId] = at;
  return out;
}

/** A parcel's CI meter from its detail: fill 0..1 and the run's state, or null without CI. */
export function ciMeter(ci: CiMessage | null | undefined): { progress: number; state: "running" | "green" | "failed" } | null {
  if (!ci?.available || !ci.phases.length) return null;
  const progress = ciProgress(ci.phases);
  const state = ci.phases.some((p) => p.status === "failed") ? "failed" : progress >= 1 ? "green" : "running";
  return { progress, state };
}
