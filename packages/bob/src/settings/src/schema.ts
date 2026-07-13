// =============================================================================
// @bob/settings/schema — User-preference settings tables.
//
// Currently contains:
//   - userPreferences (per-user theme/locale/notification settings)
// =============================================================================

import { sql } from "drizzle-orm";
import { pgTable } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

import { user } from "@bob/auth/schema";

export const userPreferences = pgTable("user_preferences", (t) => ({
  id: t.uuid().notNull().primaryKey().defaultRandom(),
  userId: t
    .text()
    .notNull()
    .unique()
    .references(() => user.id, { onDelete: "cascade" }),
  theme: t.varchar({ length: 20 }).notNull().default("system"),
  language: t.varchar({ length: 10 }).notNull().default("en"),
  timezone: t.varchar({ length: 50 }).notNull().default("UTC"),
  emailNotifications: t.boolean().notNull().default(true),
  pushNotifications: t.boolean().notNull().default(true),
  createdAt: t.timestamp({ mode: "string" }).defaultNow().notNull(),
  updatedAt: t
    .timestamp({ mode: "string", withTimezone: true })
    .$onUpdateFn(() => sql`now()`),
}));

export const CreateUserPreferencesSchema = createInsertSchema(userPreferences, {
  theme: z.enum(["light", "dark", "system"]).default("system"),
  language: z.string().max(10).default("en"),
  timezone: z.string().max(50).default("UTC"),
}).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const UpdateUserPreferencesSchema =
  CreateUserPreferencesSchema.partial().omit({
    userId: true,
  });

// Single-row runtime config for the autonomous backlog driver. Lets the
// concurrency + daily cap (and the on/off switch) be changed live without a
// worker redeploy — the cron handler reads this each tick and falls back to
// its env-var defaults when the row is absent.
export const autoDrainConfig = pgTable("auto_drain_config", (t) => ({
  id: t.integer().primaryKey().default(1),
  enabled: t.boolean().notNull().default(true),
  concurrency: t.integer().notNull().default(4),
  dailyCap: t.integer().notNull().default(20),
  updatedAt: t
    .timestamp({ mode: "string", withTimezone: true })
    .$onUpdateFn(() => sql`now()`),
}));

// Single-row runtime config for the ws-gateway trust machinery (heartbeat
// cadence, lease grace, event retention). Same live-tunable pattern as
// autoDrainConfig — the gateway reads this on its sweep tick and falls back
// to these defaults when the row is absent. Grace-period tuning happens here
// during the 10-run trust experiment, no redeploy.
export const gatewayConfig = pgTable("gateway_config", (t) => ({
  id: t.integer().primaryKey().default(1),
  // RESERVED — not yet wired. The gateway currently uses a hardcoded 30s WS
  // heartbeat (index.ts HEARTBEAT_INTERVAL_MS). Kept so the cadence can be made
  // live-tunable later without a migration; do not document it as active.
  heartbeatIntervalMs: t.integer().notNull().default(15_000),
  // Read live by the lease sweep: a lease whose heartbeat is older than this is
  // expired -> host_unknown. Too short recreates false alarms; too long
  // recreates silent death.
  leaseGraceMs: t.integer().notNull().default(60_000),
  // Read live by the outbox retention cron: output-chunk events of TERMINAL
  // runs older than this are pruned; lifecycle/transition events are kept
  // forever (trust audit trail).
  eventRetentionDays: t.integer().notNull().default(30),
  updatedAt: t
    .timestamp({ mode: "string", withTimezone: true })
    .$onUpdateFn(() => sql`now()`),
}));
