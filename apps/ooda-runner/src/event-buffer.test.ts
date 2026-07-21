import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { EventBuffer, isLifecycleFrame } from "./event-buffer";

const S1 = "11111111-1111-4111-8111-111111111111";
const S2 = "22222222-2222-4222-8222-222222222222";

function outputFrame(sessionId: string, seq: number, data = "x") {
  return {
    type: "session_event",
    sessionId,
    eventType: "output_chunk",
    direction: "agent",
    payload: { data },
    sendSeq: seq,
  };
}

function statusFrame(sessionId: string, seq: number, status = "completed") {
  return { type: "session_status", sessionId, status, sendSeq: seq };
}

describe("EventBuffer", () => {
  let dir: string;
  let buf: EventBuffer;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "event-buffer-"));
    buf = new EventBuffer(dir);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("assigns monotonic per-session send-seqs, independent across sessions", () => {
    expect(buf.assignSeq(S1)).toBe(1);
    expect(buf.assignSeq(S1)).toBe(2);
    expect(buf.assignSeq(S2)).toBe(1);
    expect(buf.assignSeq(S1)).toBe(3);
  });

  it("returns unacked frames in send order and truncates on cumulative ack", () => {
    for (let i = 1; i <= 3; i++) {
      const seq = buf.assignSeq(S1);
      buf.append(S1, seq, outputFrame(S1, seq, `chunk-${seq}`));
    }
    expect(buf.unacked(S1).map((e) => e.sendSeq)).toEqual([1, 2, 3]);

    // Cumulative: ack(2) covers 1 and 2 (everything <= 2 is durable). This
    // intentionally tolerates seqs never individually acked (session_claimed,
    // eviction-gap spans) that a contiguous watermark would stall on.
    buf.ack(S1, 2);
    expect(buf.unacked(S1).map((e) => e.sendSeq)).toEqual([3]);
    expect(buf.fullyAcked(S1)).toBe(false);

    buf.ack(S1, 3);
    expect(buf.unacked(S1)).toEqual([]);
    expect(buf.fullyAcked(S1)).toBe(true);
  });

  it("ignores a stale (lower) ack", () => {
    for (let i = 1; i <= 3; i++) {
      const seq = buf.assignSeq(S1);
      buf.append(S1, seq, outputFrame(S1, seq));
    }
    buf.ack(S1, 3);
    buf.ack(S1, 1); // stale, must not move the watermark backward
    expect(buf.unacked(S1)).toEqual([]);
  });

  it("survives restart: meta and journal reload from disk", () => {
    for (let i = 1; i <= 3; i++) {
      const seq = buf.assignSeq(S1);
      buf.append(S1, seq, outputFrame(S1, seq));
    }
    buf.ack(S1, 1);

    const reloaded = new EventBuffer(dir);
    expect(reloaded.sessionsWithUnacked()).toEqual([S1]);
    expect(reloaded.unacked(S1).map((e) => e.sendSeq)).toEqual([2, 3]);
    // Seq counter continues where it left off — no reuse of unacked seqs.
    expect(reloaded.assignSeq(S1)).toBe(4);
  });

  it("skips a torn trailing journal line instead of crashing", () => {
    const seq = buf.assignSeq(S1);
    buf.append(S1, seq, outputFrame(S1, seq));
    // Simulate a crash mid-write: append garbage without newline framing.
    writeFileSync(join(dir, `${S1}.jsonl`), `${JSON.stringify({ sendSeq: 1, frame: outputFrame(S1, 1) })}\n{"sendSeq":2,"fra`, "utf8");

    const reloaded = new EventBuffer(dir);
    expect(reloaded.unacked(S1).map((e) => e.sendSeq)).toEqual([1]);
  });

  it("evicts only non-lifecycle frames, replacing spans with gap markers", () => {
    // Tiny per-session cap forces eviction quickly.
    const small = new EventBuffer(dir + "-small", { maxBytesPerSession: 512 });
    const seqs: number[] = [];
    // Interleave: output, status, output... so the lifecycle frame sits
    // between two evictable spans.
    for (let i = 0; i < 10; i++) {
      const seq = small.assignSeq(S1);
      seqs.push(seq);
      small.append(S1, seq, outputFrame(S1, seq, "y".repeat(100)));
    }
    const statusSeq = small.assignSeq(S1);
    small.append(S1, statusSeq, statusFrame(S1, statusSeq));
    // This append exceeds the cap and triggers eviction of prior output.
    const afterSeq = small.assignSeq(S1);
    small.append(S1, afterSeq, outputFrame(S1, afterSeq, "z".repeat(100)));

    const unacked = small.unacked(S1);
    const types = unacked.map(
      (e) => (e.frame.eventType as string) ?? (e.frame.type as string),
    );
    // The status frame survived eviction.
    expect(unacked.some((e) => e.frame.type === "session_status")).toBe(true);
    // At least one gap marker replaced a dropped span.
    expect(types).toContain("gap_marker");
    // The gap marker carries the first dropped seq so ordering holds.
    const marker = unacked.find((e) => e.frame.eventType === "gap_marker")!;
    expect(marker.sendSeq).toBe(1);
    const payload = marker.frame.payload as { droppedCount: number };
    expect(payload.droppedCount).toBeGreaterThan(0);
    rmSync(dir + "-small", { recursive: true, force: true });
  });

  it("releaseSession deletes journal and meta", () => {
    const seq = buf.assignSeq(S1);
    buf.append(S1, seq, statusFrame(S1, seq));
    buf.ack(S1, seq);
    buf.releaseSession(S1);
    expect(existsSync(join(dir, `${S1}.jsonl`))).toBe(false);
    expect(existsSync(join(dir, `${S1}.meta.json`))).toBe(false);
    expect(buf.sessionsWithUnacked()).toEqual([]);
  });

  it("classifies lifecycle frames correctly", () => {
    expect(isLifecycleFrame(statusFrame(S1, 1))).toBe(true);
    expect(isLifecycleFrame({ type: "session_claimed", sessionId: S1 })).toBe(true);
    expect(
      isLifecycleFrame({ type: "session_event", eventType: "permission_request" }),
    ).toBe(true);
    expect(
      isLifecycleFrame({ type: "session_event", eventType: "state" }),
    ).toBe(true);
    expect(isLifecycleFrame(outputFrame(S1, 1))).toBe(false);
    expect(
      isLifecycleFrame({ type: "session_event", eventType: "tool_call" }),
    ).toBe(false);
  });

  it("completion in the journal survives a crash: replay-before-reconcile input", () => {
    // A run completes, the status frame is journaled, then the runner dies
    // before the ack arrives. On reload the completion MUST still be there —
    // this is the frame that prevents a false-death orphan-marking.
    const seq1 = buf.assignSeq(S1);
    buf.append(S1, seq1, outputFrame(S1, seq1));
    const seq2 = buf.assignSeq(S1);
    buf.append(S1, seq2, statusFrame(S1, seq2, "completed"));

    const reloaded = new EventBuffer(dir);
    const unacked = reloaded.unacked(S1);
    expect(unacked.map((e) => e.sendSeq)).toEqual([seq1, seq2]);
    expect(unacked[1]!.frame).toMatchObject({ type: "session_status", status: "completed" });
  });
});
