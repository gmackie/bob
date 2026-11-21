import { describe, expect, it } from "vitest";
import { MAX_WATCHED_ITEMS } from "@bob/sdlc-view";
import type { CiMessage, ShippedEntry, TailFrame } from "@bob/sdlc-view";

import { chooseDesks, DESK_LINES, DESK_QUIET_MS, deskRank, desks, sameDesks, shippedToday } from "../src/desks";
import { delta, snapshot, viewOf } from "./fixtures";
import type { Spec } from "./fixtures";

const NOW = Date.parse("2026-11-20T12:00:00Z");

const frame = (itemId: string, lines: string[], at = NOW - 5_000): TailFrame => ({
  itemId,
  attemptId: `a-${itemId}`,
  threadId: `t-${itemId}`,
  lines,
  threadStatus: "running",
  at: new Date(at).toISOString(),
});

describe("deskRank", () => {
  it("puts needs-you first and gives idle or finished items no desk", () => {
    expect(deskRank({ attention: "needs_human", item: { state: "running" } })).toBe(0);
    expect(deskRank({ attention: "ok", item: { state: "running" } })).toBe(1);
    expect(deskRank({ attention: "ok", item: { state: "validating" } })).toBe(2);
    expect(deskRank({ attention: "ok", item: { state: "reserved" } })).toBe(3);
    expect(deskRank({ attention: "stalled", item: { state: "execution-unknown" } })).toBe(4);
    expect(deskRank({ attention: "stalled", item: { state: "running" } })).toBe(4);
    expect(deskRank({ attention: "needs_human", item: { state: "validating" } })).toBe(0);
    for (const state of ["pending", "ready", "completed", "failed", "cancelled", "cancelling"] as const) {
      expect(deskRank({ attention: "needs_human", item: { state } })).toBeNull();
    }
  });
});

describe("chooseDesks", () => {
  const specs: Spec[] = [
    { itemId: "c", state: "validating" },
    { itemId: "a", state: "running" },
    { itemId: "w", state: "waiting-input" },
    { itemId: "r", state: "reserved" },
    { itemId: "p", state: "pending" },
    { itemId: "done", state: "completed" },
  ];
  const view = viewOf(snapshot(specs));

  it("orders by rank and gives only active items a desk", () => {
    expect(chooseDesks(view)).toEqual(["w", "a", "c", "r"]);
  });

  it("is deterministic for shuffled input", () => {
    const shuffled = viewOf(snapshot([...specs].reverse()));
    expect(chooseDesks(shuffled)).toEqual(chooseDesks(view));
  });

  it("never returns more than MAX_WATCHED_ITEMS", () => {
    const many = viewOf(snapshot(Array.from({ length: 10 }, (_, i) => ({ itemId: `i${i}`, state: "running" as const }))));
    expect(chooseDesks(many)).toHaveLength(MAX_WATCHED_ITEMS);
    expect(chooseDesks(many, [], { limit: 99 })).toHaveLength(MAX_WATCHED_ITEMS);
    expect(chooseDesks(many, [], { limit: 2 })).toEqual(["i0", "i1"]);
  });

  it("keeps previous desks among equal ranks, in their old slots", () => {
    const many = viewOf(snapshot(Array.from({ length: 8 }, (_, i) => ({ itemId: `i${i}`, state: "running" as const }))));
    const previous = ["i7", "i6", "i2"];
    const chosen = chooseDesks(many, previous);
    expect(chosen.slice(0, 3)).toEqual(previous);
    expect(chosen.slice(3)).toEqual(["i0", "i1", "i3"]);
  });

  it("lets a needs-you item take a desk from a lower rank", () => {
    const base = viewOf(snapshot(Array.from({ length: 6 }, (_, i) => ({ itemId: `i${i}`, state: "validating" as const })), "e1", 1));
    const first = chooseDesks(base);
    expect(first).toHaveLength(6);
    const later = [snapshot(Array.from({ length: 6 }, (_, i) => ({ itemId: `i${i}`, state: "validating" as const })), "e1", 1)];
    const withAsk = viewOf(...later, delta(2, [{ itemId: "i5", state: "validating", rv: 1 }]));
    expect(chooseDesks(withAsk, first)).toEqual(first);
    const ask = viewOf(snapshot([...Array.from({ length: 6 }, (_, i) => ({ itemId: `i${i}`, state: "validating" as const })), { itemId: "zz", state: "waiting-input" }]));
    const chosen = chooseDesks(ask, first);
    expect(chosen).toContain("zz");
    expect(chosen).toHaveLength(6);
    expect(chosen.at(-1)).toBe("zz");
    expect(chosen).not.toContain("i5");
  });

  it("gives stalled items desks only after every moving item, even ones it held before", () => {
    const stuck = viewOf(snapshot([
      { itemId: "s", state: "execution-unknown" },
      ...Array.from({ length: 6 }, (_, i) => ({ itemId: `r${i}`, state: "reserved" as const })),
    ]));
    expect(chooseDesks(stuck, ["s"])).toEqual(["r0", "r1", "r2", "r3", "r4", "r5"]);
    const few = viewOf(snapshot([{ itemId: "s", state: "execution-unknown" }, { itemId: "r", state: "reserved" }]));
    expect(chooseDesks(few)).toEqual(["r", "s"]);
  });

  it("drops desks whose item left or stopped working", () => {
    const next = viewOf(snapshot([{ itemId: "a", state: "completed" }, { itemId: "c", state: "validating" }]));
    expect(chooseDesks(next, ["a", "c", "gone"])).toEqual(["c"]);
  });

  it("honours exclude and scope", () => {
    expect(chooseDesks(view, [], { exclude: ["w"] })).toEqual(["a", "c", "r"]);
    const mixed = viewOf(snapshot([{ itemId: "x", state: "running", repo: "forgegraph" }, { itemId: "y", state: "running" }]));
    expect(chooseDesks(mixed, [], { scope: { repoKey: "forgegraph:forgegraph" } })).toEqual(["x"]);
  });
});

describe("sameDesks", () => {
  it("compares ids and order", () => {
    expect(sameDesks(["a", "b"], ["a", "b"])).toBe(true);
    expect(sameDesks(["a", "b"], ["b", "a"])).toBe(false);
    expect(sameDesks([], ["a"])).toBe(false);
  });
});

describe("desks", () => {
  const view = viewOf(snapshot([
    { itemId: "a", state: "running", identifier: "BOB-1" },
    { itemId: "c", state: "validating", identifier: "BOB-2" },
    { itemId: "q", state: "reserved", identifier: "BOB-3" },
  ]));
  const ci: CiMessage = { type: "ci", itemId: "c", available: true, sha: "abc", summary: "2/3 passed", phases: [{ name: "lint", status: "passed" }, { name: "test", status: "running" }], at: new Date(NOW).toISOString() };

  it("shows the newest tail lines and CI only from the edge", () => {
    const lines = ["one", "two", "three", "four", "five", "six"];
    const detail = { a: { tail: frame("a", lines) }, c: { ci } } as const;
    const out = desks(view, ["a", "c", "q"], (id) => detail[id as keyof typeof detail], NOW);
    expect(out.map((d) => d.itemId)).toEqual(["a", "c", "q"]);
    const [a, c, q] = out;
    expect(a?.lines).toEqual(lines.slice(-DESK_LINES));
    expect(a?.threadStatus).toBe("running");
    expect(a?.quiet).toBe(false);
    expect(a?.note).toBeNull();
    expect(c?.ci).toEqual({ summary: "2/3 passed", phases: ci.phases });
    expect(c?.lines).toEqual([]);
    expect(q?.lines).toEqual([]);
    expect(q?.ci).toBeNull();
    expect(q?.accessibilityLabel).toContain("no live detail yet");
  });

  it("marks an old tail quiet and shows the edge's reason when there is no tail", () => {
    const detail = {
      a: { tail: frame("a", ["thinking"], NOW - DESK_QUIET_MS - 1) },
      c: { tailUnavailable: "relay has not posted for this item" },
      q: { ci: { type: "ci", itemId: "q", available: false, reason: "no pipeline yet", at: "" } satisfies CiMessage },
    };
    const [a, c, q] = desks(view, ["a", "c", "q"], (id) => detail[id as keyof typeof detail], NOW);
    expect(a?.quiet).toBe(true);
    expect(c?.note).toBe("relay has not posted for this item");
    expect(q?.note).toBe("no pipeline yet");
  });

  it("tells apart desks that share an issue key and leaves unique keys alone", () => {
    const shared = viewOf(snapshot([
      { itemId: "B", state: "validating", identifier: "BOB-72" },
      { itemId: "kill-recovery", state: "validating", identifier: "BOB-72" },
      { itemId: "A", state: "validating", identifier: "BOB-71" },
    ]));
    const out = desks(shared, ["B", "kill-recovery", "A"], () => undefined, NOW);
    expect(out.map((d) => d.label)).toEqual(["BOB-72 · B", "BOB-72 · kill-rec", "BOB-71"]);
    expect(out[1]?.accessibilityLabel.startsWith("BOB-72 · kill-rec,")).toBe(true);
    // A key is only ambiguous among the desks shown.
    expect(desks(shared, ["B", "A"], () => undefined, NOW).map((d) => d.label)).toEqual(["BOB-72", "BOB-71"]);
  });

  it("ignores a tail for another item and skips items that left", () => {
    const out = desks(view, ["gone", "a"], () => ({ tail: frame("other", ["x"]) }), NOW);
    expect(out.map((d) => d.itemId)).toEqual(["a"]);
    expect(out[0]?.lines).toEqual([]);
  });
});

describe("shippedToday", () => {
  it("counts entries since local midnight", () => {
    const midnight = new Date(NOW);
    midnight.setHours(0, 0, 0, 0);
    const entry = (itemId: string, at: number): ShippedEntry => ({ itemId, planId: "p", issue: null, repository: null, at });
    expect(shippedToday([entry("a", NOW - 1000), entry("b", midnight.getTime()), entry("c", midnight.getTime() - 1)], NOW)).toBe(2);
    expect(shippedToday([], NOW)).toBe(0);
  });
});
