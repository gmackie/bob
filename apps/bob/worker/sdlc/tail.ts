// BOB-80 (BOB-75 Phase 3): the live tail at the edge. The coordinator's tail relay POSTs
// TailFrame[] to /api/sdlc/tail; the DO keeps only the latest frame per item, in memory,
// and sends it to the sockets watching that item. Nothing here is ever written to storage.
import { stripTerminalControls, TAIL_LIMITS, type TailFrame, type TailUnavailableMessage } from "@bob/sdlc-view";

/** Tail bodies above this are refused (413). A full batch (50 frames x 40 lines x 200 chars) is about 400 KB, so the relay (runtime/tail.mjs) splits batches to stay under it. */
export const MAX_TAIL_BYTES = 256 * 1024;
/** A running or waiting-input item with no frame for this long gets a TailUnavailableMessage on watch. */
export const TAIL_STALE_MS = 60_000;
/** At most this many items' latest frames are held; the least recently updated go first. */
export const MAX_TAIL_ITEMS = 200;
/** Item states for which the relay is expected to be posting. */
export const LIVE_STATES: ReadonlySet<string> = new Set(["running", "waiting-input"]);

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isId = (v: unknown): v is string => typeof v === "string" && v.length > 0 && v.length <= 200;
const isShort = (v: unknown): v is string => typeof v === "string" && v.length > 0 && v.length <= 64;

/**
 * Validates one frame and clamps it to TAIL_LIMITS: the last maxLines lines, each cut to
 * maxLineChars. Lines and threadStatus are agent-controlled: escape sequences and control
 * characters are stripped (tabs become spaces) so no surface can be driven by them. Null when malformed.
 */
export function parseTailFrame(raw: unknown): TailFrame | null {
  if (!isRecord(raw) || !isId(raw.itemId) || !isId(raw.attemptId) || !isId(raw.threadId)) return null;
  if (!isShort(raw.threadStatus) || !isShort(raw.at) || !Array.isArray(raw.lines)) return null;
  if (!raw.lines.every((line) => typeof line === "string")) return null;
  const lines = (raw.lines as string[]).slice(-TAIL_LIMITS.maxLines).map((line) => stripTerminalControls(line).replace(/\t/g, "  ").slice(0, TAIL_LIMITS.maxLineChars));
  const threadStatus = stripTerminalControls(raw.threadStatus) || "unknown";
  return { itemId: raw.itemId, attemptId: raw.attemptId, threadId: raw.threadId, lines, threadStatus, at: raw.at };
}

/**
 * Validates a tail body `{frames: TailFrame[]}`. Any malformed frame refuses the whole
 * body (null). More than maxFramesPerPost keeps the last ones; within a post only the
 * last frame per item is kept, since a frame replaces the item's tail.
 */
export function parseTailPost(value: unknown): TailFrame[] | null {
  if (!isRecord(value) || !Array.isArray(value.frames)) return null;
  const frames: TailFrame[] = [];
  for (const raw of value.frames.slice(-TAIL_LIMITS.maxFramesPerPost)) {
    const frame = parseTailFrame(raw);
    if (!frame) return null;
    frames.push(frame);
  }
  const last = new Map<string, TailFrame>();
  for (const frame of frames) { last.delete(frame.itemId); last.set(frame.itemId, frame); }
  return [...last.values()];
}

/** The latest frame per item and when it arrived (the edge's clock), bounded to MAX_TAIL_ITEMS. Memory only. */
export class TailHub {
  private readonly latest = new Map<string, { frame: TailFrame; receivedAt: number }>();
  constructor(private readonly maxItems = MAX_TAIL_ITEMS) {}

  put(frame: TailFrame, now: number): void {
    this.latest.delete(frame.itemId); // re-inserted last: Map order is least recently updated first
    this.latest.set(frame.itemId, { frame, receivedAt: now });
    while (this.latest.size > this.maxItems) this.latest.delete(this.latest.keys().next().value!);
  }
  get(itemId: string): { frame: TailFrame; receivedAt: number } | undefined {
    return this.latest.get(itemId);
  }
  get size(): number { return this.latest.size; }

  /** The unavailable marker for a newly watching socket, or null when the tail is fresh or not expected. */
  unavailable(itemId: string, state: string | undefined, now: number): TailUnavailableMessage | null {
    if (state === undefined || !LIVE_STATES.has(state)) return null;
    const hit = this.latest.get(itemId);
    if (hit && now - hit.receivedAt <= TAIL_STALE_MS) return null;
    return { type: "tailUnavailable", itemId, reason: hit ? "The relay has not sent live output in the last minute." : "No live output from the relay yet." };
  }
}
