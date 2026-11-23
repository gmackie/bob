import { describe, expect, it } from "vitest";

import { normalizeTimestamp, timestampToMillis } from "./timestamps";

/**
 * Drizzle string-mode columns arrive as Postgres text. Node parses some of
 * it; Hermes parses none of it, so every relative time on a device read
 * "No activity". These pin the shapes the gateway and API actually send.
 */
describe("normalizeTimestamp", () => {
  it("turns a timestamptz with a short zone into ISO 8601", () => {
    expect(normalizeTimestamp("2026-09-30 16:51:29.479-04")).toBe(
      "2026-09-30T16:51:29.479-04:00",
    );
  });

  it("treats a zoneless timestamp as UTC, which is how the server writes it", () => {
    expect(normalizeTimestamp("2026-09-30 20:51:29.479")).toBe(
      "2026-09-30T20:51:29.479Z",
    );
    expect(normalizeTimestamp("2026-09-30 20:51:29")).toBe(
      "2026-09-30T20:51:29Z",
    );
  });

  it("leaves ISO input alone", () => {
    expect(normalizeTimestamp("2026-09-30T20:51:29.479Z")).toBe(
      "2026-09-30T20:51:29.479Z",
    );
    expect(normalizeTimestamp("2026-09-30T16:51:29+05:30")).toBe(
      "2026-09-30T16:51:29+05:30",
    );
  });

  it("does not touch strings it does not recognise", () => {
    expect(normalizeTimestamp("yesterday")).toBe("yesterday");
  });
});

describe("timestampToMillis", () => {
  it("agrees across the forms the same instant takes", () => {
    const iso = timestampToMillis("2026-09-30T20:51:29.479Z");
    expect(timestampToMillis("2026-09-30 16:51:29.479-04")).toBe(iso);
    expect(timestampToMillis("2026-09-30 20:51:29.479")).toBe(iso);
    expect(timestampToMillis(new Date("2026-09-30T20:51:29.479Z"))).toBe(iso);
  });

  it("returns null for nothing and for garbage", () => {
    expect(timestampToMillis(null)).toBeNull();
    expect(timestampToMillis(undefined)).toBeNull();
    expect(timestampToMillis("")).toBeNull();
    expect(timestampToMillis("not a date")).toBeNull();
  });
});
