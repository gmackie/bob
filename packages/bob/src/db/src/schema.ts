// @bob/db/schema — Thin barrel re-exporting from co-located area packages.
// All 62+ `from "@bob/db/schema"` import sites keep working unchanged.
export * from "@bob/auth/schema";
export * from "@bob/tenancy/schema";

// gmacko auth tables — canonical plural names (users, sessions, accounts,
// verifications). These are the SAME underlying pgTable objects as the singular
// aliases (user, session, account, verification) from `@bob/auth/schema` above.
// Both are needed: singular for FK references in Bob's area packages, plural for
// better-auth's drizzle adapter with `usePlural: true`. client-pglite.ts dedupes
// by object identity before passing to drizzle-kit's DDL generator.
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
export {
  agentPersonas,
  personaSource,
  agentPersonasInsertSchema,
  agentPersonasSelectSchema,
  type AgentPersona,
  type NewAgentPersona,
} from "@gmacko/core/db/schema/agent-personas";
