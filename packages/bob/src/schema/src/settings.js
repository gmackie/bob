"use strict";
// =============================================================================
// @bob/settings/schema — User-preference settings tables.
//
// Currently contains:
//   - userPreferences (per-user theme/locale/notification settings)
// =============================================================================
var __makeTemplateObject = (this && this.__makeTemplateObject) || function (cooked, raw) {
    if (Object.defineProperty) { Object.defineProperty(cooked, "raw", { value: raw }); } else { cooked.raw = raw; }
    return cooked;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.gatewayConfig = exports.cockpitAudit = exports.autoDrainConfig = exports.UpdateUserPreferencesSchema = exports.CreateUserPreferencesSchema = exports.userPreferences = void 0;
var drizzle_orm_1 = require("drizzle-orm");
var pg_core_1 = require("drizzle-orm/pg-core");
var drizzle_zod_1 = require("drizzle-zod");
var v4_1 = require("zod/v4");
var auth_js_1 = require("./auth.js");
exports.userPreferences = (0, pg_core_1.pgTable)("user_preferences", function (t) { return ({
    id: t.uuid().notNull().primaryKey().defaultRandom(),
    userId: t
        .text()
        .notNull()
        .unique()
        .references(function () { return auth_js_1.user.id; }, { onDelete: "cascade" }),
    theme: t.varchar({ length: 20 }).notNull().default("system"),
    language: t.varchar({ length: 10 }).notNull().default("en"),
    timezone: t.varchar({ length: 50 }).notNull().default("UTC"),
    // Master switches. These remain an absolute veto over their channel, so
    // turning push off in settings genuinely silences push whatever the
    // per-type rows say. Per-type refinement lives in notificationPreferences.
    emailNotifications: t.boolean().notNull().default(true),
    pushNotifications: t.boolean().notNull().default(true),
    // "HH:MM" in the user's timezone column above. Null = no quiet hours.
    // Suppresses push and email only; the in-app record is never withheld,
    // because quiet hours are about not being disturbed, not losing history.
    quietHoursStart: t.varchar({ length: 5 }),
    quietHoursEnd: t.varchar({ length: 5 }),
    createdAt: t.timestamp({ mode: "string" }).defaultNow().notNull(),
    updatedAt: t
        .timestamp({ mode: "string", withTimezone: true })
        .$onUpdateFn(function () { return (0, drizzle_orm_1.sql)(templateObject_1 || (templateObject_1 = __makeTemplateObject(["now()"], ["now()"]))); }),
}); });
exports.CreateUserPreferencesSchema = (0, drizzle_zod_1.createInsertSchema)(exports.userPreferences, {
    theme: v4_1.z.enum(["light", "dark", "system"]).default("system"),
    language: v4_1.z.string().max(10).default("en"),
    timezone: v4_1.z.string().max(50).default("UTC"),
}).omit({
    id: true,
    createdAt: true,
    updatedAt: true,
});
exports.UpdateUserPreferencesSchema = exports.CreateUserPreferencesSchema.partial().omit({
    userId: true,
});
// Single-row runtime config for the autonomous backlog driver. Lets the
// concurrency + daily cap (and the on/off switch) be changed live without a
// worker redeploy — the cron handler reads this each tick and falls back to
// its env-var defaults when the row is absent.
exports.autoDrainConfig = (0, pg_core_1.pgTable)("auto_drain_config", function (t) { return ({
    id: t.integer().primaryKey().default(1),
    enabled: t.boolean().notNull().default(true),
    concurrency: t.integer().notNull().default(4),
    dailyCap: t.integer().notNull().default(20),
    // Agents a human pulled from rotation via the cockpit (persists across
    // deploys, unlike the transient health gate).
    disabledAgents: t.jsonb().$type().notNull().default([]),
    updatedAt: t
        .timestamp({ mode: "string", withTimezone: true })
        .$onUpdateFn(function () { return (0, drizzle_orm_1.sql)(templateObject_2 || (templateObject_2 = __makeTemplateObject(["now()"], ["now()"]))); }),
}); });
// One row per cockpit mutation — who pressed what, on what. Rendered in the
// cockpit timeline so human interventions are first-class history.
exports.cockpitAudit = (0, pg_core_1.pgTable)("cockpit_audit", function (t) { return ({
    id: t.uuid().notNull().primaryKey().defaultRandom(),
    userId: t.text().notNull(),
    action: t.varchar({ length: 40 }).notNull(),
    target: t.text(),
    payload: t.jsonb().$type().notNull().default({}),
    createdAt: t.timestamp({ mode: "string", withTimezone: true }).notNull().defaultNow(),
}); });
// Single-row runtime config for the ws-gateway trust machinery (heartbeat
// cadence, lease grace, event retention). Same live-tunable pattern as
// autoDrainConfig — the gateway reads this on its sweep tick and falls back
// to these defaults when the row is absent. Grace-period tuning happens here
// during the 10-run trust experiment, no redeploy.
exports.gatewayConfig = (0, pg_core_1.pgTable)("gateway_config", function (t) { return ({
    id: t.integer().primaryKey().default(1),
    // RESERVED — not yet wired. The gateway currently uses a hardcoded 30s WS
    // heartbeat (index.ts HEARTBEAT_INTERVAL_MS). Kept so the cadence can be made
    // live-tunable later without a migration; do not document it as active.
    heartbeatIntervalMs: t.integer().notNull().default(15000),
    // Read live by the lease sweep: a lease whose heartbeat is older than this is
    // expired -> host_unknown. Too short recreates false alarms; too long
    // recreates silent death.
    leaseGraceMs: t.integer().notNull().default(60000),
    // Read live by the outbox retention cron: output-chunk events of TERMINAL
    // runs older than this are pruned; lifecycle/transition events are kept
    // forever (trust audit trail).
    eventRetentionDays: t.integer().notNull().default(30),
    updatedAt: t
        .timestamp({ mode: "string", withTimezone: true })
        .$onUpdateFn(function () { return (0, drizzle_orm_1.sql)(templateObject_3 || (templateObject_3 = __makeTemplateObject(["now()"], ["now()"]))); }),
}); });
var templateObject_1, templateObject_2, templateObject_3;
