/**
 * Timestamps cross the RPC boundary in more than one runtime shape, and the
 * contract has to accept all of them or the response fails to encode.
 *
 * Bob's Drizzle schema declares `timestamp({ mode: "string" })` in 144 places,
 * so its handlers return raw strings. gmacko's own handlers and stubs return
 * JS `Date` values (see the notes in schemas/projects.ts and schemas/agent.ts).
 * `Schema.DateTimeUtc` accepts neither, so on 2026-08-30 every settings RPC
 * failed to encode with `Expected DateTime.Utc, got "2026-08-21 19:51:47.55"`
 * and the settings page rendered blank.
 */
import { describe, expect, it } from "vitest";
import { DateTime, Schema } from "effect";

import { WireTimestamp } from "../wire-timestamp.js";

const decode = Schema.decodeUnknownSync(WireTimestamp);

describe("WireTimestamp", () => {
  it("accepts a Postgres timestamp string, which is what Bob's handlers return", () => {
    expect(() => decode("2026-08-21 19:51:47.550158")).not.toThrow();
  });

  it("accepts an ISO-8601 string", () => {
    expect(() => decode("2026-08-21T19:51:47.550Z")).not.toThrow();
  });

  it("accepts a JS Date, which gmacko's handlers return", () => {
    expect(() => decode(new Date("2026-08-21T19:51:47.550Z"))).not.toThrow();
  });

  it("accepts a DateTime.Utc, which the contract stubs return", () => {
    expect(() => decode(DateTime.makeUnsafe("2026-04-22T00:00:00.000Z"))).not.toThrow();
  });

  it("rejects a value that is not a timestamp at all", () => {
    expect(() => decode(12345)).toThrow();
  });

  it("round-trips inside a struct the way a real success schema does", () => {
    const S = Schema.Struct({ createdAt: WireTimestamp });
    const enc = Schema.encodeUnknownSync(S);
    expect(() => enc({ createdAt: "2026-08-21 19:51:47.550158" })).not.toThrow();
    expect(() => enc({ createdAt: new Date() })).not.toThrow();
  });
});
