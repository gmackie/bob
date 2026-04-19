import { sql } from "drizzle-orm";
import {
  pgTable,
  uuid,
  varchar,
  text,
  integer,
  jsonb,
  timestamp,
  index,
  unique,
  pgEnum,
} from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { tenants } from "./tenancy.js";

// Runner tables — back the shared runner protocol in @gmacko/runner-protocol
// + @gmacko/runner-base (Phase 6F). A "runner" is a process that registers
// with the API, advertises capabilities, claims work, and reports events.
//
// - `runner_devices`: one row per registered runner process
// - `runner_capabilities`: many capabilities per device (e.g. can_codex)
// - `task_runs`: one unit of work; gets claimed by a device
// - `task_run_events`: append-only event stream from runner back to server
//
// All three pgEnums use distinct Postgres type names (runner_device_status,
// task_run_status, task_run_event_type) — none overlap with the session_status
// / chat_message_role / tenant_role / message_role enums in other schemas.

export const runnerDeviceStatus = pgEnum("runner_device_status", [
  "idle",
  "busy",
  "draining",
  "offline",
]);

export const taskRunStatus = pgEnum("task_run_status", [
  "pending",
  "claimed",
  "running",
  "completed",
  "failed",
  "canceled",
]);

export const taskRunEventType = pgEnum("task_run_event_type", [
  "status_change",
  "stdout",
  "stderr",
  "tool_call",
  "tool_result",
  "error",
  "metric",
]);

export const runnerDevices = pgTable(
  "runner_devices",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    hostname: varchar("hostname", { length: 256 }).notNull(),
    status: runnerDeviceStatus("status").notNull().default("offline"),
    lastHeartbeatAt: timestamp("last_heartbeat_at", {
      withTimezone: true,
      mode: "date",
    }),
    metadata: jsonb("metadata")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    registeredAt: timestamp("registered_at", {
      withTimezone: true,
      mode: "date",
    })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    tenantIdIdx: index("runner_devices_tenant_id_idx").on(table.tenantId),
    statusIdx: index("runner_devices_status_idx").on(table.status),
  }),
);

export const runnerCapabilities = pgTable(
  "runner_capabilities",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    deviceId: uuid("device_id")
      .notNull()
      .references(() => runnerDevices.id, { onDelete: "cascade" }),
    capability: varchar("capability", { length: 128 }).notNull(),
    metadata: jsonb("metadata")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    capabilityIdx: index("runner_capabilities_capability_idx").on(
      table.capability,
    ),
    uniqueDeviceCapability: unique(
      "runner_capabilities_device_capability_unique",
    ).on(table.deviceId, table.capability),
  }),
);

export const taskRuns = pgTable(
  "task_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    status: taskRunStatus("status").notNull().default("pending"),
    capabilitiesRequired: text("capabilities_required")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    // claimedByDeviceId is nullable and SET NULL on device delete so the
    // task_run row survives the device it was once claimed by. Other claim
    // fields (claimedAt, startedAt) are preserved as runner-protocol history.
    claimedByDeviceId: uuid("claimed_by_device_id").references(
      () => runnerDevices.id,
      { onDelete: "set null" },
    ),
    input: jsonb("input")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    result: jsonb("result").$type<Record<string, unknown>>(),
    errorMessage: text("error_message"),
    claimedAt: timestamp("claimed_at", { withTimezone: true, mode: "date" }),
    startedAt: timestamp("started_at", { withTimezone: true, mode: "date" }),
    completedAt: timestamp("completed_at", {
      withTimezone: true,
      mode: "date",
    }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    tenantIdIdx: index("task_runs_tenant_id_idx").on(table.tenantId),
    statusIdx: index("task_runs_status_idx").on(table.status),
    claimedByDeviceIdIdx: index("task_runs_claimed_by_device_id_idx").on(
      table.claimedByDeviceId,
    ),
  }),
);

export const taskRunEvents = pgTable(
  "task_run_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    runId: uuid("run_id")
      .notNull()
      .references(() => taskRuns.id, { onDelete: "cascade" }),
    seq: integer("seq").notNull(),
    type: taskRunEventType("type").notNull(),
    payload: jsonb("payload")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    runIdIdx: index("task_run_events_run_id_idx").on(table.runId),
    uniqueRunSeq: unique("task_run_events_run_seq_unique").on(
      table.runId,
      table.seq,
    ),
  }),
);

// drizzle-zod schemas for RPC validation
export const runnerDevicesInsertSchema = createInsertSchema(runnerDevices);
export const runnerDevicesSelectSchema = createSelectSchema(runnerDevices);
export const runnerCapabilitiesInsertSchema =
  createInsertSchema(runnerCapabilities);
export const runnerCapabilitiesSelectSchema =
  createSelectSchema(runnerCapabilities);
export const taskRunsInsertSchema = createInsertSchema(taskRuns);
export const taskRunsSelectSchema = createSelectSchema(taskRuns);
export const taskRunEventsInsertSchema = createInsertSchema(taskRunEvents);
export const taskRunEventsSelectSchema = createSelectSchema(taskRunEvents);

// Row type exports
export type RunnerDevice = typeof runnerDevices.$inferSelect;
export type NewRunnerDevice = typeof runnerDevices.$inferInsert;
export type RunnerCapability = typeof runnerCapabilities.$inferSelect;
export type NewRunnerCapability = typeof runnerCapabilities.$inferInsert;
export type TaskRun = typeof taskRuns.$inferSelect;
export type NewTaskRun = typeof taskRuns.$inferInsert;
export type TaskRunEvent = typeof taskRunEvents.$inferSelect;
export type NewTaskRunEvent = typeof taskRunEvents.$inferInsert;
