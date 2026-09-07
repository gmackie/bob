import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { DurableJournal } from "./durable-journal.js";

describe("durable producer journal", () => {
  it("replays across restart and exact ACK retains lower unacknowledged holes", () => {
    const dir = mkdtempSync(join(tmpdir(), "bob-journal-"));
    try {
      let j = new DurableJournal(dir, 10000);
      const one = j.append({
        type: "session_status",
        sessionId: "s",
        status: "running",
      });
      const two = j.append({
        type: "session_status",
        sessionId: "s",
        status: "completed",
      });
      j.ack("s", two.sendSeq);
      j.close();
      j = new DurableJournal(dir, 10000);
      expect(j.pending()).toEqual([one]);
      j.ack("s", one.sendSeq);
      j.close();
      j = new DurableJournal(dir, 10000);
      expect(j.append({ type: "session_event", sessionId: "s" }).sendSeq).toBe(
        3,
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it("fails closed on corruption and bounded storage instead of dropping frames", () => {
    const dir = mkdtempSync(join(tmpdir(), "bob-journal-"));
    try {
      const j = new DurableJournal(dir, 100);
      expect(() =>
        j.append({ sessionId: "s", data: "x".repeat(200) }),
      ).toThrow();
      expect(j.pending()).toEqual([]);
      j.close();
      writeFileSync(join(dir, "journal.sqlite"), "{");
      expect(() => new DurableJournal(dir)).toThrow();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

it("refuses concurrent journal owners and invalid loaded counters", () => {
  const dir = mkdtempSync(join(tmpdir(), "bob-owner-"));
  try {
    const j = new DurableJournal(dir);
    expect(() => new DurableJournal(dir)).toThrow("owned");
    j.close();
    writeFileSync(
      join(dir, "journal.sqlite"),
      JSON.stringify({ next: {}, frames: [{ sessionId: "s", sendSeq: 2 }] }),
    );
    expect(() => new DurableJournal(dir)).toThrow();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

it("retains active execution after running ACK and reserves room for terminal receipt", () => {
  const dir = mkdtempSync(join(tmpdir(), "bob-capacity-"));
  try {
    let j = new DurableJournal(dir, 1000);
    const running = j.append({
      type: "session_status",
      sessionId: "s",
      status: "running",
    });
    j.ack("s", running.sendSeq);
    expect(j.activeSessions()).toEqual([{ sessionId: "s", process: null }]);
    j.append({ type: "session_event", sessionId: "s", data: "x".repeat(600) });
    expect(() =>
      j.append({
        type: "session_event",
        sessionId: "s",
        data: "x".repeat(200),
      }),
    ).toThrow("capacity");
    const terminal = j.append({
      type: "session_status",
      sessionId: "s",
      status: "interrupted",
    });
    expect(j.activeSessions()).toEqual([]);
    j.ack("s", terminal.sendSeq);
    j.close();
    j = new DurableJournal(dir, 1000);
    expect(j.hasCompleted("s")).toBe(true);
    j.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
