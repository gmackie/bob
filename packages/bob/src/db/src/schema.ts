// @bob/db/schema — Aggregate of the canonical leaf schema definitions.
// All 62+ `from "@bob/schema/db"` import sites keep working unchanged.
export * from "@bob/schema/auth";
export * from "@bob/schema/tenancy";

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
export * from "@bob/schema/settings";
export * from "@bob/schema/projects";
export * from "@bob/schema/work-items";
export * from "@bob/schema/agents";
export * from "@bob/schema/chat";
export * from "@bob/schema/git";
export * from "@bob/schema/webhooks";
export * from "@bob/schema/ci";
export * from "@bob/schema/notifications";
export * from "@bob/schema/cookies";
export * from "@bob/schema/secrets";
export * from "./hermes-schema.js";
export {
  agentPersonas,
  personaSource,
  agentPersonasInsertSchema,
  agentPersonasSelectSchema,
  type AgentPersona,
  type NewAgentPersona,
} from "@gmacko/core/db/schema/agent-personas";
