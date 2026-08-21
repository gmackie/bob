import { describe, expect, it } from "vitest";

import { detectStarvation } from "../starvation";

const H = 60 * 60 * 1000;
const base = { dispatchable: 10, executeToday: 5, dailyCap: 40, activeSessions: 1, concurrency: 4, msSinceLastExecute: 3 * H, windowMs: 2 * H };

describe("detectStarvation", () => {
  it("flags work waiting with free slots, cap headroom and a long quiet period", () => {
    expect(detectStarvation(base)).toEqual({ starved: true, reason: "starved" });
  });
  it("never pages on an empty queue", () => {
    expect(detectStarvation({ ...base, dispatchable: 0 }).reason).toBe("no_work");
  });
  it("cap reached is a known throttle, not starvation", () => {
    expect(detectStarvation({ ...base, executeToday: 40 }).reason).toBe("cap_reached");
  });
  it("all slots busy is a known throttle, not starvation", () => {
    expect(detectStarvation({ ...base, activeSessions: 4 }).reason).toBe("slots_busy");
  });
  it("a recent dispatch resets the clock", () => {
    expect(detectStarvation({ ...base, msSinceLastExecute: 10 * 60 * 1000 }).reason).toBe("recent_dispatch");
  });
  it("no execute run at all today counts as infinitely quiet", () => {
    expect(detectStarvation({ ...base, executeToday: 0, msSinceLastExecute: Infinity }).starved).toBe(true);
  });
});
