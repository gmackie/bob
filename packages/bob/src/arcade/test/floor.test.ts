import { describe, expect, it } from "vitest";
import { ITEM_STATES } from "@bob/sdlc-view";

import { FLOOR_STATIONS, floorScene, floorSummary, hueFor, stationFor } from "../src/floor";
import { hud } from "../src/hud";
import { snapshot, viewOf } from "./fixtures";
import type { Spec } from "./fixtures";

const specs: Spec[] = [
  { itemId: "1", state: "running" },
  { itemId: "2", state: "waiting-input" },
  { itemId: "3", state: "validating", release: { stage: "checks-running" } },
  { itemId: "4", state: "review", release: { stage: "review-ready" } },
  { itemId: "5", state: "failed" },
  { itemId: "6", state: "completed", repo: "forgegraph" },
];
const view = viewOf(snapshot(specs));

describe("FLOOR_STATIONS", () => {
  it("parks every item state at exactly one station", () => {
    for (const s of ITEM_STATES) expect(FLOOR_STATIONS.filter((st) => st.states.includes(s))).toHaveLength(1);
    expect(stationFor("waiting-input")).toBe("agents");
  });
});

describe("floorScene", () => {
  it("places every item, attention first, at its station", () => {
    const scene = floorScene(view, { width: 1024, height: 600 });
    expect(scene.orientation).toBe("wide");
    expect(scene.parcels.map((p) => p.itemId).sort()).toEqual(["1", "2", "3", "4", "5", "6"]);
    const agents = scene.parcels.filter((p) => p.stationId === "agents");
    expect(agents.map((p) => p.itemId)).toEqual(["2", "1"]);
    expect(agents[0]!.marker).toBe("!");
    expect(agents[0]!.y).toBeLessThan(agents[1]!.y);
    expect(scene.parcels.find((p) => p.itemId === "3")!.release).toBe("Checks running");
    expect(scene.stations.find((s) => s.id === "agents")!.attention).toBe("needs_human");
  });

  it("lays the belt top to bottom in a tall box", () => {
    const scene = floorScene(view, { width: 390, height: 700 });
    expect(scene.orientation).toBe("tall");
    const y = (id: string) => scene.stations.find((s) => s.id === id)!.y;
    expect(y("queue")).toBeLessThan(y("agents"));
    expect(y("agents")).toBeLessThan(y("shipped"));
    for (const p of scene.parcels) {
      expect(p.x).toBeGreaterThan(0);
      expect(p.x).toBeLessThan(390);
      expect(p.y).toBeLessThan(700);
    }
  });

  it("uses the wide floor on an iPad in portrait", () => {
    expect(floorScene(view, { width: 720, height: 1200 }).orientation).toBe("wide");
  });

  it("collapses a crowded station into an overflow counter", () => {
    const crowd = viewOf(snapshot(Array.from({ length: 30 }, (_, i) => ({ itemId: `c${String(i).padStart(2, "0")}`, state: "running" as const }))));
    const scene = floorScene(crowd, { width: 1024, height: 400 });
    const shown = scene.parcels.length;
    const over = scene.overflow.find((o) => o.stationId === "agents")!;
    expect(shown + over.count).toBe(30);
    expect(shown).toBeGreaterThan(0);
  });

  it("is deterministic and stable per repository", () => {
    expect(floorScene(view, { width: 800, height: 500 })).toEqual(floorScene(view, { width: 800, height: 500 }));
    expect(hueFor("forgegraph:bob")).toBe(hueFor("forgegraph:bob"));
    const scene = floorScene(view, { width: 800, height: 500 });
    expect(scene.parcels.find((p) => p.itemId === "6")!.hue).not.toBe(scene.parcels.find((p) => p.itemId === "1")!.hue);
  });

  it("reads as text", () => {
    const lines = floorSummary(floorScene(view, { width: 1024, height: 600 }));
    expect(lines).toContain("Agents: BOB-2 (needs human), BOB-1");
    expect(lines).toContain("Failed: BOB-5 (failed)");
  });
});

describe("hud", () => {
  it("counts live items", () => {
    expect(hud(view)).toEqual({ agents: 1, inFlight: 4, ci: 1, needsYou: 2, deploying: 0, shipped: 1, failed: 1 });
  });
});
