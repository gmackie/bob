import { describe, expect, it } from "vitest";
import { createBeatLog, floorScene, sdlcBeats } from "@bob/arcade";
import { emptyView, reduce, STATE_EDGES } from "@bob/sdlc-view";

import { demoDeskDetail, demoFeed } from "./demo-feed";

describe("demoFeed", () => {
  it("is a valid edge script: contiguous deltas, real transitions, every item finishes", () => {
    const { snapshot, deltas } = demoFeed("e", 0);
    let view = reduce(emptyView(), snapshot);
    const allowed = new Set(STATE_EDGES.map((e) => `${e.from}>${e.to}`));
    // The script also uses running <-> waiting-input, which the contract declares but no edge writes yet.
    allowed.add("running>waiting-input").add("waiting-input>running").add("validating>validating");
    const log = createBeatLog(1000);
    for (const d of deltas) {
      const next = reduce(view, d);
      expect(next.needsResync).toBe(false);
      for (const [id, item] of Object.entries(next.items)) {
        const before = view.items[id];
        if (!before) throw new Error(`delta introduced unknown item ${id}`);
        if (before.state !== item.state) expect(allowed.has(`${before.state}>${item.state}`)).toBe(true);
      }
      log.push(sdlcBeats(view, next, 0));
      view = next;
    }
    expect(Object.values(view.items).every((i) => i.state === "completed" || i.state === "failed")).toBe(true);
    const kinds = new Set(log.recent().map((b) => b.kind));
    for (const k of ["item.advanced", "item.looped", "item.needs_human", "item.failed", "milestone"] as const) expect(kinds.has(k)).toBe(true);
    // The demo project's floor: its 9 scripted items plus its one started issue (BOB-99).
    const scene = floorScene(view, { width: 390, height: 600 }, { projectId: "demo" });
    expect(scene.parcels.length + scene.overflow.reduce((n, o) => n + o.count, 0)).toBe(10);
    expect(scene.backlog).toBe(1);
  });
});

describe("demoDeskDetail (BOB-98)", () => {
  it("scripts tail lines for agents, CI for checks, and a reason otherwise", () => {
    const now = Date.parse("2026-11-20T12:00:00Z");
    const running = demoDeskDetail("running", "demo-1", 3, now);
    expect(running.tail?.lines.length).toBeGreaterThan(0);
    expect(running.tail?.itemId).toBe("demo-1");
    expect(demoDeskDetail("waiting-input", "demo-1", 3, now).tail?.lines.at(-1)).toMatch(/^asking:/);
    const ci = demoDeskDetail("validating", "demo-2", 1, now).ci;
    expect(ci?.available).toBe(true);
    expect(demoDeskDetail("review", "demo-2", 1, now).ci).toMatchObject({ summary: "5/5 passed" });
    expect(demoDeskDetail("reserved", "demo-3", 0, now)).toEqual({ tailUnavailable: "the agent has not started yet" });
    expect(demoDeskDetail("running", "demo-1", 3, now)).toEqual(running);
  });
});
