// Wire-format schemas for the Auth RPC contract group.
//
// These mirror shapes from `@gmacko/auth` (e.g. `CurrentUserShape` in
// `@gmacko/rpc/context`) but live in the contracts package so the
// public wire format can evolve independently from the source packages'
// runtime types. A change to the auth package's internal types does not
// auto-break the contract — any drift surfaces as a Schema mismatch
// caught in tests.
//
// Timestamps use `Schema.DateTimeUtcFromString` (verified present at
// `effect/dist/Schema.d.ts:5944`). On the wire they travel as ISO-8601
// strings; after decode they become `DateTimeUtc`.
import { Schema } from "effect";

// Mirror of @gmacko/rpc/context::CurrentUserShape as a wire schema.
// Roles mirror @gmacko/validators::TenantMemberRole.
export const CurrentUserSchema = Schema.Struct({
  userId: Schema.String,
  tenantId: Schema.String, // UUID at the type level in the source package, loose-string on the wire
  email: Schema.String,
  role: Schema.Literals(["owner", "admin", "member"]),
});
export type CurrentUserWire = typeof CurrentUserSchema.Type;

// Tenant membership row.
export const MembershipSchema = Schema.Struct({
  tenantId: Schema.String,
  role: Schema.Literals(["owner", "admin", "member"]),
});
export type MembershipWire = typeof MembershipSchema.Type;

// Listed API key (no plaintext — that only exists at issue time).
export const ApiKeyListItemSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  keyPrefix: Schema.String,
  permissions: Schema.Array(Schema.Literals(["read", "write", "admin"])),
  createdAt: Schema.DateTimeUtcFromString,
  revokedAt: Schema.NullOr(Schema.DateTimeUtcFromString),
  lastUsedAt: Schema.NullOr(Schema.DateTimeUtcFromString),
  expiresAt: Schema.NullOr(Schema.DateTimeUtcFromString),
});
export type ApiKeyListItemWire = typeof ApiKeyListItemSchema.Type;

// Device-code poll result — tagged union over the lifecycle states.
// The "consumed" state is the one-shot state where we return the minted
// API key plaintext; after that the code is gone.
export const DeviceCodePollResultSchema = Schema.Union([
  Schema.Struct({ status: Schema.Literal("pending") }),
  Schema.Struct({ status: Schema.Literal("approved") }),
  Schema.Struct({
    status: Schema.Literal("consumed"),
    apiKey: Schema.Struct({
      id: Schema.String,
      plaintext: Schema.String,
    }),
  }),
  Schema.Struct({ status: Schema.Literal("denied") }),
  Schema.Struct({ status: Schema.Literal("expired") }),
]);
export type DeviceCodePollResultWire = typeof DeviceCodePollResultSchema.Type;

// Issue-time API key response. Plaintext is returned exactly once here.
export const ApiKeyIssueResultSchema = Schema.Struct({
  id: Schema.String,
  plaintext: Schema.String,
  keyPrefix: Schema.String,
});
export type ApiKeyIssueResultWire = typeof ApiKeyIssueResultSchema.Type;

// Start-device-flow response.
export const DeviceFlowStartResultSchema = Schema.Struct({
  deviceCode: Schema.String,
  userCode: Schema.String,
  verificationUri: Schema.String,
  expiresAt: Schema.DateTimeUtcFromString,
});
export type DeviceFlowStartResultWire = typeof DeviceFlowStartResultSchema.Type;
