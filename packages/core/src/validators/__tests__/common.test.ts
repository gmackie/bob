import { describe, expect, it } from "vitest";
import { Schema } from "effect";
import { Email, NonEmptyString, Timestamp } from "../common.js";

describe("@gmacko/validators/common Timestamp", () => {
  const iso = "2026-04-19T10:00:00Z";
  const expectedMs = Date.UTC(2026, 3, 19, 10, 0, 0);

  it("decodes an ISO string into a JS Date instance", () => {
    const decoded = Schema.decodeUnknownSync(Timestamp)(iso);
    expect(decoded).toBeInstanceOf(Date);
    expect(decoded.getTime()).toBe(expectedMs);
  });

  it("round-trips: decode → encode → decode yields the same Date", () => {
    const once = Schema.decodeUnknownSync(Timestamp)(iso);
    const encoded = Schema.encodeSync(Timestamp)(once);
    expect(typeof encoded).toBe("string");
    const twice = Schema.decodeUnknownSync(Timestamp)(encoded);
    expect(twice).toBeInstanceOf(Date);
    expect(twice.getTime()).toBe(once.getTime());
  });

  it("rejects non-string input", () => {
    expect(() =>
      Schema.decodeUnknownSync(Timestamp)(12345 as unknown),
    ).toThrow();
  });

  it("rejects an unparseable string", () => {
    expect(() => Schema.decodeUnknownSync(Timestamp)("not a date")).toThrow();
  });
});

describe("@gmacko/validators/common NonEmptyString", () => {
  it("accepts a non-empty string", () => {
    expect(Schema.decodeUnknownSync(NonEmptyString)("hello")).toBe("hello");
  });

  it("rejects an empty string", () => {
    expect(() => Schema.decodeUnknownSync(NonEmptyString)("")).toThrow();
  });
});

describe("@gmacko/validators/common Email", () => {
  it("accepts a valid email", () => {
    expect(Schema.decodeUnknownSync(Email)("user@example.com")).toBe(
      "user@example.com",
    );
  });

  it("rejects a string that is not an email", () => {
    expect(() => Schema.decodeUnknownSync(Email)("not-an-email")).toThrow();
  });

  it("rejects an email missing a TLD segment", () => {
    expect(() => Schema.decodeUnknownSync(Email)("missing@domain")).toThrow();
  });
});
