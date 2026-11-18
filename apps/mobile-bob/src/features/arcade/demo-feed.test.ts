import { describe, expect, it } from "vitest";
import { createBeatLog, floorScene, sdlcBeats } from "@bob/arcade";
import { emptyView, reduce, STATE_EDGES } from "@bob/sdlc-view";

import { demoFeed } from "./demo-feed";

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
        const before = view.items[id]!;
        if (before.state !== item.state) expect(allowed.has(`${before.state}>${item.state}`)).toBe(true);
      }
      log.push(sdlcBeats(view, next, 0));
      view = next;
    }
    expect(Object.values(view.items).every((i) => i.state === "completed" || i.state === "failed")).toBe(true);
    const kinds = new Set(log.recent().map((b) => b.kind));
    for (const k of ["item.advanced", "item.looped", "item.needs_human", "item.failed", "milestone"] as const) expect(kinds.has(k)).toBe(true);
    const scene = floorScene(view, { width: 390, height: 600 });
    expect(scene.parcels.length + scene.overflow.reduce((n, o) => n + o.count, 0)).toBe(9);
  });
});
