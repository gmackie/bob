// Wire schemas for the SecretsRpc contract group. Mirrors the runtime shape
// defined in `@gmacko/db/schema/secrets::SessionSecretPolicy` and
// `@gmacko/secrets::SecretEnvelope` so stubs and real handlers share the same
// encode/decode surface.
import { Schema } from "effect";

/**
 * Wire schema for `SessionSecretPolicy`. Every field is optional — an empty
 * object is a valid "no restrictions" policy.
 */
export const SessionSecretPolicySchema = Schema.Struct({
  allowedTemplates: Schema.optional(Schema.Array(Schema.String)),
  allowedArgPrefixes: Schema.optional(
    Schema.Record(Schema.String, Schema.Array(Schema.String)),
  ),
  maxUses: Schema.optional(Schema.Number),
  redactOutput: Schema.optional(Schema.Boolean),
});
export type SessionSecretPolicyWire = typeof SessionSecretPolicySchema.Type;

/**
 * Wire schema for `SecretEnvelope` — the no-plaintext, tenant-scoped view of a
 * stored secret. Timestamps serialize as `Date` to match the existing Thread /
 * Message convention (`Schema.Date`), not ISO strings.
 */
export const SecretEnvelopeSchema = Schema.Struct({
  id: Schema.String.check(Schema.isUUID()),
  tenantId: Schema.String.check(Schema.isUUID()),
  name: Schema.String,
  policy: SessionSecretPolicySchema,
  usesRemaining: Schema.NullOr(Schema.Number),
  createdAt: Schema.Date,
  updatedAt: Schema.Date,
});
export type SecretEnvelopeWire = typeof SecretEnvelopeSchema.Type;
