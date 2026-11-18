import { describe, expect, it } from "vitest";
import { MAX_SHIPPED_ENTRIES, mergeShipped, parseShippedMessage, shippedSince, startOfLocalDay, type ShippedEntry } from "../src";

const entry = (itemId: string, at: number, extra: Partial<ShippedEntry> = {}): ShippedEntry =>
  ({ itemId, planId: "p1", issue: `BOB-${itemId}`, repository: "bob", at, ...extra });

describe("mergeShipped (BOB-95)", () => {
  it("replace swaps the list; additions merge newest first", () => {
    const start = mergeShipped([entry("old", 1)], { type: "shipped", replace: true, entries: [entry("a", 10), entry("b", 20)] });
    expect(start.map((e) => e.itemId)).toEqual(["b", "a"]);
    const next = mergeShipped(start, { type: "shipped", replace: false, entries: [entry("c", 30)] });
    expect(next.map((e) => e.itemId)).toEqual(["c", "b", "a"]);
  });
  it("keeps one entry per item, the earliest", () => {
    const list = mergeShipped([entry("a", 10)], { type: "shipped", replace: false, entries: [entry("a", 50)] });
    expect(list).toEqual([entry("a", 10)]);
  });
  it("caps the list", () => {
    const many = Array.from({ length: MAX_SHIPPED_ENTRIES + 5 }, (_, i) => entry(`i${i}`, i));
    expect(mergeShipped([], { type: "shipped", replace: true, entries: many })).toHaveLength(MAX_SHIPPED_ENTRIES);
  });
});

describe("shippedSince / startOfLocalDay", () => {
  it("filters to the day", () => {
    const now = new Date(2026, 10, 18, 15, 30).getTime();
    const day = startOfLocalDay(now);
    expect(day).toBe(new Date(2026, 10, 18).getTime());
    const list = [entry("today", day + 1), entry("midnight", day), entry("yesterday", day - 1)];
    expect(shippedSince(list, day).map((e) => e.itemId)).toEqual(["today", "midnight"]);
  });
});

describe("parseShippedMessage", () => {
  it("accepts a message as text or value", () => {
    const message = { type: "shipped", replace: false, entries: [entry("a", 1, { issue: null, repository: null })] };
    expect(parseShippedMessage(JSON.stringify(message))).toEqual(message);
    expect(parseShippedMessage(message)).toEqual(message);
  });
  it("drops unknown fields and refuses malformed messages", () => {
    expect(parseShippedMessage({ type: "shipped", replace: true, entries: [{ ...entry("a", 1), extra: 1 }] })!.entries[0]).toEqual(entry("a", 1));
    for (const bad of [
      "nope", null, { type: "tail" }, { type: "shipped", entries: [] }, { type: "shipped", replace: true, entries: {} },
      { type: "shipped", replace: true, entries: [{ ...entry("a", 1), at: "x" }] },
      { type: "shipped", replace: true, entries: [{ ...entry("a", 1), itemId: "" }] },
      { type: "shipped", replace: true, entries: [{ ...entry("a", 1), issue: 3 }] },
    ]) expect(parseShippedMessage(bad)).toBeNull();
  });
});
