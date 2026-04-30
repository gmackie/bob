// @bob/db/schema — Thin barrel re-exporting from co-located area packages.
// All 62+ `from "@bob/db/schema"` import sites keep working unchanged.
export * from "@bob/auth/schema";
export * from "@bob/tenancy/schema";

// gmacko auth tables — better-auth-shaped (plural table names: users, sessions,
// accounts, verifications). These coexist with Bob's singular-named auth tables
// (user, session, account, verification) so both schema sets bootstrap in one DB.
// Tenancy / api-keys / device-codes are NOT re-exported because Bob already owns
// those table names (tenants, api_keys, device_codes).
export {
  users,
  sessions,
  accounts,
  verifications,
} from "@gmacko/core/db/schema/auth";
export * from "@bob/settings/schema";
export * from "@bob/projects/schema";
export * from "@bob/work-items/schema";
export * from "@bob/agents/schema";
export * from "@bob/chat/schema";
export * from "@bob/git/schema";
export * from "@bob/webhooks/schema";
export * from "@bob/ci/schema";
export * from "@bob/notifications/schema";
export * from "@bob/cookies/schema";
export * from "@bob/secrets/schema";
