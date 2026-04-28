// Wire schema for the `Project` domain type.
//
// `createdAt` / `updatedAt` use `Schema.Date` (matching the existing
// `packages/contracts/src/schemas/thread.ts` convention) rather than
// `Schema.DateTimeUtcFromString` — the stubs + runtime handlers pass raw
// JS `Date` values through unchanged, and `Schema.Date`'s default JSON
// serializer encodes them as ISO-8601 strings on the wire.
import { Schema } from "effect";

export const ProjectSchema = Schema.Struct({
  id: Schema.String, // UUID — not branded on the wire
  tenantId: Schema.String, // UUID
  slug: Schema.String,
  name: Schema.String,
  createdAt: Schema.Date,
  updatedAt: Schema.Date,
});
export type ProjectWire = typeof ProjectSchema.Type;
