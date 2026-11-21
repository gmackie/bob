import { describe, expect, it } from "vitest";
import { ITEM_STATES } from "@bob/sdlc-view";

import { FLOOR_STATIONS, floorScene, floorSummary, hueFor, PARCEL_TONE, shortAge, stationFor } from "../src/floor";
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
    expect(hud(view)).toEqual({ agents: 1, inFlight: 4, ci: 1, needsYou: 2, stalled: 0, deploying: 0, shipped: 1, failed: 1 });
  });
});

describe("readable floor (BOB-101)", () => {
  const H = 3_600_000;
  const now = 100 * 24 * H;

  it("colours parcels by where the work is, and only scrap is red", () => {
    const scene = floorScene(view, { width: 1024, height: 600 });
    const tone = (id: string) => scene.parcels.find((p) => p.itemId === id)!.tone;
    expect(tone("6")).toBe("shipped");
    expect(tone("5")).toBe("failed");
    expect(tone("3")).toBe("ci");
    expect(scene.parcels.filter((p) => PARCEL_TONE[p.tone].fill === PARCEL_TONE.failed.fill).map((p) => p.itemId)).toEqual(["5"]);
  });

  it("tells apart parcels that share an issue key by their item name", () => {
    const twins = viewOf(snapshot([
      { itemId: "B", state: "validating", identifier: "BOB-72" },
      { itemId: "kill-recovery-attempt", state: "validating", identifier: "BOB-72" },
      { itemId: "A", state: "validating", identifier: "BOB-71" },
    ]));
    const scene = floorScene(twins, { width: 390, height: 700 });
    const sub = Object.fromEntries(scene.parcels.map((p) => [p.itemId, p.sublabel]));
    expect(sub).toEqual({ B: "B", "kill-recovery-attempt": "kill-recove…", A: null });
    expect(floorSummary(scene)).toContain("CI: BOB-71, BOB-72 B, BOB-72 kill-recove…");
  });

  it("ages parcels and flags the ones stuck past their state's limit", () => {
    const aged = viewOf(snapshot([
      { itemId: "old", state: "validating", stateSince: now - 9 * 24 * H },
      { itemId: "new", state: "validating", stateSince: now - 40 * 60_000 },
      { itemId: "unknown", state: "validating", stateSince: null },
    ]));
    const scene = floorScene(aged, { width: 390, height: 700 }, { now });
    const at = (id: string) => scene.parcels.find((p) => p.itemId === id)!;
    expect(at("old")).toMatchObject({ age: "9d", attention: "stalled", marker: "?" });
    expect(at("new")).toMatchObject({ age: "40m", attention: "ok", marker: null });
    expect(at("unknown")).toMatchObject({ age: null, attention: "ok" });
    expect(hud(aged, {}, now).stalled).toBe(1);
    expect(floorScene(aged, { width: 390, height: 700 }).parcels.every((p) => p.age === null && p.attention === "ok")).toBe(true);
  });

  it("collapses empty stations on a phone and gives the height to busy ones", () => {
    const scene = floorScene(viewOf(snapshot([
      { itemId: "1", state: "validating" }, { itemId: "2", state: "validating" }, { itemId: "3", state: "validating" },
      { itemId: "4", state: "validating" }, { itemId: "5", state: "completed" },
    ])), { width: 390, height: 700 });
    const y = (id: string) => scene.stations.find((s) => s.id === id)!.y;
    // Six empty stations above and between take thin rows, not an eighth of the height each.
    expect(y("ready") - y("queue")).toBeLessThan(60);
    // Four CI parcels wrap onto a second row instead of overflowing.
    const ci = scene.parcels.filter((p) => p.stationId === "ci");
    expect(ci).toHaveLength(4);
    expect(new Set(ci.map((p) => p.y)).size).toBe(2);
    expect(scene.overflow).toEqual([]);
    for (const p of scene.parcels) {
      expect(p.x + scene.parcel.w / 2).toBeLessThanOrEqual(390);
      expect(p.y + scene.parcel.h / 2).toBeLessThanOrEqual(700);
    }
  });

  it("still overflows when a phone cannot fit a station", () => {
    const crowd = viewOf(snapshot(Array.from({ length: 80 }, (_, i) => ({ itemId: `c${String(i).padStart(2, "0")}`, state: "running" as const }))));
    const scene = floorScene(crowd, { width: 390, height: 500 });
    const over = scene.overflow.find((o) => o.stationId === "agents")!;
    expect(scene.parcels.length + over.count).toBe(80);
    for (const p of scene.parcels) expect(p.y + scene.parcel.h / 2).toBeLessThanOrEqual(500);
  });

  it("keeps a phone on the tall floor even when the box is wider than tall", () => {
    // The desks under the floor can squeeze its box to, say, 390 × 300 on an iPhone.
    expect(floorScene(view, { width: 390, height: 300 }).orientation).toBe("tall");
    expect(floorScene(view, { width: 1024, height: 300 }).orientation).toBe("wide");
  });

  it("shows a phone's failed parcels instead of hiding them all behind a counter", () => {
    const scrap = viewOf(snapshot([{ itemId: "f1", state: "failed" }, { itemId: "f2", state: "failed" }, { itemId: "ok", state: "running" }]));
    const scene = floorScene(scrap, { width: 390, height: 600 });
    expect(scene.parcels.filter((p) => p.stationId === "scrap").map((p) => p.itemId).sort()).toEqual(["f1", "f2"]);
    expect(scene.overflow).toEqual([]);
    for (const p of scene.parcels) expect(p.y + scene.parcel.h / 2).toBeLessThanOrEqual(600);
  });

  it("writes ages in three characters", () => {
    expect(shortAge(0)).toBe("1m");
    expect(shortAge(59 * 60_000)).toBe("59m");
    expect(shortAge(47 * H)).toBe("47h");
    expect(shortAge(9 * 24 * H)).toBe("9d");
  });
});
