// All tagged errors exposed by @gmacko/auth, hoisted to a dependency-free
// subpath so client bundles can import them via `@gmacko/auth/errors`
// without dragging in better-auth, drizzle, @gmacko/db, or any node:* APIs.
//
// Why this exists: see docs/plans/2026-04-25-phase7a-punchlist.md Task 6.
//
// Parity rule: every TaggedErrorClass declared in service modules
// (api-keys.ts / device-codes.ts / sessions.ts / tenancy.ts /
// runner-sessions.ts) is mirrored here. The service modules re-export from
// this file, so a single import path (`@gmacko/auth`) still works for
// in-tree code while `@gmacko/contracts` and other client-bundle consumers
// import from `@gmacko/auth/errors`.
//
// IMPORTANT: this file MUST keep a single import — `effect/Schema` — so the
// subpath stays node:* / better-auth / drizzle / @gmacko/db free.
import { Schema } from "effect";

export class InvalidApiKeyError extends Schema.TaggedErrorClass<InvalidApiKeyError>()(
  "InvalidApiKeyError",
  { message: Schema.String },
) {}

export class InvalidDeviceCodeError extends Schema.TaggedErrorClass<InvalidDeviceCodeError>()(
  "InvalidDeviceCodeError",
  { message: Schema.String },
) {}

export class InvalidUserCodeError extends Schema.TaggedErrorClass<InvalidUserCodeError>()(
  "InvalidUserCodeError",
  { message: Schema.String },
) {}

export class AlreadyApprovedError extends Schema.TaggedErrorClass<AlreadyApprovedError>()(
  "AlreadyApprovedError",
  { message: Schema.String },
) {}

export class SessionExpiredError extends Schema.TaggedErrorClass<SessionExpiredError>()(
  "SessionExpiredError",
  { message: Schema.String },
) {}

// Tenancy errors. We deliberately use `Schema.String` for the branded id
// fields (UserId, TenantId) to keep the tagged errors structural and avoid
// running the brand decoders at construct time — the branding is enforced
// by the service method signatures at the boundary.
export class NotAMemberError extends Schema.TaggedErrorClass<NotAMemberError>()(
  "NotAMemberError",
  { userId: Schema.String, tenantId: Schema.String },
) {}

// `required` / `actual` are tenant member roles. We inline the literal
// instead of importing `TenantMemberRole` from `@gmacko/validators` to keep
// this module's import surface to a single line. Runtime is identical:
// `TenantMemberRole` IS `Schema.Literals(["owner", "admin", "member"])`.
export class InsufficientRoleError extends Schema.TaggedErrorClass<InsufficientRoleError>()(
  "InsufficientRoleError",
  {
    required: Schema.Literals(["owner", "admin", "member"]),
    actual: Schema.Literals(["owner", "admin", "member"]),
  },
) {}

export class TenantNotSelectedError extends Schema.TaggedErrorClass<TenantNotSelectedError>()(
  "TenantNotSelectedError",
  {
    message: Schema.String,
    memberships: Schema.Array(
      Schema.Struct({
        tenantId: Schema.String,
        role: Schema.Literals(["owner", "admin", "member"]),
      }),
    ),
  },
) {}

/**
 * Reason tag surfaced to callers. `malformed` = structure invalid (wrong
 * dot count, non-JSON payload, missing fields); `signature` = HMAC mismatch;
 * `expired` = past `expiresAt`.
 */
export class InvalidRunnerSessionError extends Schema.TaggedErrorClass<InvalidRunnerSessionError>()(
  "InvalidRunnerSessionError",
  { reason: Schema.Literals(["malformed", "signature", "expired"]) },
) {}
