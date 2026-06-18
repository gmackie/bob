// All tagged errors exposed by @gmacko/secrets, hoisted to a dependency-free
// subpath so client bundles can import them via `@gmacko/secrets/errors`
// without dragging in drizzle, @gmacko/db, or any node:* APIs.
//
// Why this exists: see docs/plans/2026-04-25-phase7a-punchlist.md Task 7.
//
// Parity rule: every TaggedErrorClass declared in `secrets.ts` is mirrored
// here. The service module re-exports from this file, so a single import
// path (`@gmacko/secrets`) still works for in-tree code while
// `@gmacko/contracts` and other client-bundle consumers import from
// `@gmacko/secrets/errors`.
//
// IMPORTANT: this file MUST keep a single import — `effect/Schema` — so the
// subpath stays node:* / drizzle / @gmacko/db free.
import { Schema } from "effect";

// Branded ids (`SessionSecretId`, `TenantId`) are serialised as bare
// `Schema.String` to keep this module dependency-free; the brand is enforced
// at the service-method boundary so the tagged error doesn't need to re-run
// the brand decoder at construct time.
export class SecretNotFoundError extends Schema.TaggedErrorClass<SecretNotFoundError>()(
  "SecretNotFoundError",
  { secretId: Schema.String, tenantId: Schema.String },
) {}

export class SecretNameConflictError extends Schema.TaggedErrorClass<SecretNameConflictError>()(
  "SecretNameConflictError",
  { tenantId: Schema.String, name: Schema.String },
) {}

export class PolicyDeniedError extends Schema.TaggedErrorClass<PolicyDeniedError>()(
  "PolicyDeniedError",
  {
    reason: Schema.Literals(["template", "argPrefix", "noTemplateId"]),
    templateId: Schema.optional(Schema.String),
    expected: Schema.optional(Schema.Array(Schema.String)),
  },
) {}

export class MaxUsesExceededError extends Schema.TaggedErrorClass<MaxUsesExceededError>()(
  "MaxUsesExceededError",
  { secretId: Schema.String, maxUses: Schema.Number },
) {}
