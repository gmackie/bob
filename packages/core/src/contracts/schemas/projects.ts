// Wire schema for the `Project` domain type.
//
// `createdAt` / `updatedAt` use `WireTimestamp` (matching the existing
// `packages/contracts/src/schemas/thread.ts` convention) rather than
// `WireTimestamp` — the stubs + runtime handlers pass raw
// JS `Date` values through unchanged, and `WireTimestamp`'s default JSON
// serializer encodes them as ISO-8601 strings on the wire.
import { Schema } from "effect";

import { WireTimestamp } from "./wire-timestamp.js";

export const ProjectSchema = Schema.Struct({
  id: Schema.String, // UUID — not branded on the wire
  tenantId: Schema.String, // UUID
  slug: Schema.String,
  name: Schema.String,
  createdAt: WireTimestamp,
  updatedAt: WireTimestamp,
});
export type ProjectWire = typeof ProjectSchema.Type;
