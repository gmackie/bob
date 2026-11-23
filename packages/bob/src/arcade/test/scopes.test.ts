import { describe, expect, it } from "vitest";

import { floorScene } from "../src/floor";
import { floorScopes, liveScope } from "../src/scopes";
import { hueFor } from "../src/floor";
import { snapshot, viewOf } from "./fixtures";

const view = viewOf(
  snapshot([
    { itemId: "1", state: "running" },
    { itemId: "2", state: "failed" },
    { itemId: "3", state: "running", repo: "forgegraph" },
  ]),
);

describe("floorScopes", () => {
  it("offers repo chips with their parcel hue, busiest first", () => {
    const { projects, repos } = floorScopes(view);
    expect(projects).toEqual([]);
    expect(repos.map((r) => [r.label, r.count, r.attention])).toEqual([
      ["bob", 2, 1],
      ["forgegraph", 1, 0],
    ]);
    expect(repos[1]!.hue).toBe(hueFor("forgegraph:forgegraph"));
    expect(repos[1]!.scope).toEqual({ repoKey: "forgegraph:forgegraph" });
  });

  it("offers no chips when there is nothing to choose", () => {
    expect(floorScopes(viewOf(snapshot([{ itemId: "1", state: "running" }])))).toEqual({ projects: [], repos: [] });
  });
});

describe("liveScope", () => {
  it("drops a repo that left the floor", () => {
    expect(liveScope(view, { repoKey: "forgegraph:forgegraph" })).toEqual({ repoKey: "forgegraph:forgegraph" });
    expect(liveScope(view, { repoKey: "forgegraph:gone" })).toEqual({});
  });
});

describe("floorScene density", () => {
  const crowd = viewOf(snapshot(Array.from({ length: 9 }, (_, i) => ({ itemId: `c${i}`, state: "running" as const, identifier: `BOB-${100 + i}` }))));

  it("goes compact before collapsing a crowd, and only when asked", () => {
    const normal = floorScene(crowd, { width: 1024, height: 300 });
    expect(normal.density).toBe("normal");
    expect(normal.overflow).toHaveLength(1);
    const auto = floorScene(crowd, { width: 1024, height: 300 }, { density: "auto" });
    expect(auto.density).toBe("compact");
    expect(auto.parcel.h).toBeLessThan(normal.parcel.h);
    expect(auto.parcels.length).toBeGreaterThan(normal.parcels.length);
    expect(auto.parcels[0]!.short).toBe("100");
  });

  it("stays normal when there is room", () => {
    expect(floorScene(viewOf(snapshot([{ itemId: "1", state: "running" }])), { width: 1024, height: 300 }, { density: "auto" }).density).toBe("normal");
  });
});
