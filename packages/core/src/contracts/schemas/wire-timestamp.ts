import { Schema } from "effect";

/**
 * A timestamp as it actually arrives at the RPC boundary.
 *
 * `Schema.DateTimeUtc` accepts only a `DateTime.Utc`, which no handler in this
 * repo produces. Bob's Drizzle tables declare `timestamp({ mode: "string" })`
 * in 144 places, so its handlers return raw Postgres strings; gmacko's own
 * handlers and stubs return JS `Date` values (see the notes in ./projects.ts
 * and ./agent.ts, which sidestepped this by reaching for `Schema.Date`).
 *
 * Using DateTimeUtc anyway meant every settings RPC failed to ENCODE its
 * response — `Expected DateTime.Utc, got "2026-08-21 19:51:47.550158"` — which
 * the server returned as a 200 with an error body, so the settings page went
 * blank with nothing logged (2026-08-30).
 *
 * Accepting all three shapes keeps the wire format honest: `Schema.Date` and
 * `Schema.DateTimeUtc` both serialize to ISO-8601, and a string passes through
 * as-is.
 */
export const WireTimestamp = Schema.Union([
  // Bob's Drizzle handlers (`timestamp({ mode: "string" })`).
  Schema.String,
  // gmacko's runtime handlers.
  Schema.Date,
  // gmacko's contract stubs.
  Schema.DateTimeUtc,
]);
export type WireTimestamp = typeof WireTimestamp.Type;
