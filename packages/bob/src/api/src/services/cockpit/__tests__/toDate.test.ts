import { describe, expect, it } from "vitest";

import { toDate } from "../toDate";

describe("toDate", () => {
  it("parses Postgres timestamptz with an hour-only offset (the shape JS rejects)", () => {
    expect(toDate("2026-08-23 19:07:44.955+00")?.toISOString()).toBe("2026-08-23T19:07:44.955Z");
    expect(toDate("2026-08-23 15:07:44-04")?.toISOString()).toBe("2026-08-23T19:07:44.000Z");
  });
  it("treats naive timestamps as UTC", () => {
    expect(toDate("2026-08-23 17:25:24.123")?.toISOString()).toBe("2026-08-23T17:25:24.123Z");
  });
  it("passes ISO strings and Dates through", () => {
    expect(toDate("2026-08-23T17:25:24Z")?.toISOString()).toBe("2026-08-23T17:25:24.000Z");
    const d = new Date("2026-01-01T00:00:00Z");
    expect(toDate(d)).toBe(d);
  });
  it("never returns an Invalid Date", () => {
    expect(toDate("garbage")).toBeNull();
    expect(toDate(null)).toBeNull();
    expect(toDate(new Date("nope"))).toBeNull();
  });
});
