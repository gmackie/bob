// Wire schemas + tagged errors for the runner protocol.
//
// Mirrors the DB enums + `task_runs` / `task_run_events` row shapes declared
// in `@gmacko/db` (`packages/db/src/schema/runner.ts`). Using literal unions
// here (rather than re-exporting drizzle-zod `createSelectSchema`) lets the
// wire schema evolve independently of DB columns (e.g. we never want to leak
// internal columns to runners) and keeps `@gmacko/runner-protocol` from
// pulling `@gmacko/db` into its runtime closure.
//
// Verified Effect 4.0.0-beta.43 APIs used below:
//   - `Schema.Literals([...])` — array-arg literal union (Schema.d.ts:2667).
//   - `Schema.Record(key, value)` — positional args (Schema.d.ts:2114).
//   - `Schema.Date` — decodes to JS `Date` (Schema.d.ts:5218). Preferred over
//     `Schema.DateTimeUtcFromString` which decodes to `DateTime.Utc` and
//     forces consumers onto the Effect DateTime API (6F drift Task 4 hit).
//   - `Schema.TaggedErrorClass<Self>()(id, fields)` — mirrors the existing
//     `@gmacko/contracts` error definitions.

import { Schema } from "effect";

// --- Literal domains (mirroring DB enums) -----------------------------------

export const RunnerDeviceStatusSchema = Schema.Literals([
  "idle",
  "busy",
  "draining",
  "offline",
]);
export type RunnerDeviceStatus = typeof RunnerDeviceStatusSchema.Type;

export const TaskRunStatusSchema = Schema.Literals([
  "pending",
  "claimed",
  "running",
  "completed",
  "failed",
  "canceled",
]);
export type TaskRunStatus = typeof TaskRunStatusSchema.Type;

export const TaskRunEventTypeSchema = Schema.Literals([
  "status_change",
  "stdout",
  "stderr",
  "tool_call",
  "tool_result",
  "error",
  "metric",
]);
export type TaskRunEventType = typeof TaskRunEventTypeSchema.Type;

// --- Capability (open string union — products extend freely) ----------------

export const CapabilitySchema = Schema.String;
export type Capability = typeof CapabilitySchema.Type;

// --- TaskRun wire shape -----------------------------------------------------

export const TaskRunSchema = Schema.Struct({
  id: Schema.String, // UUID
  tenantId: Schema.String, // UUID
  status: TaskRunStatusSchema,
  capabilitiesRequired: Schema.Array(CapabilitySchema),
  claimedByDeviceId: Schema.NullOr(Schema.String),
  input: Schema.Record(Schema.String, Schema.Unknown),
  result: Schema.NullOr(Schema.Record(Schema.String, Schema.Unknown)),
  errorMessage: Schema.NullOr(Schema.String),
  claimedAt: Schema.NullOr(Schema.Date),
  startedAt: Schema.NullOr(Schema.Date),
  completedAt: Schema.NullOr(Schema.Date),
  createdAt: Schema.Date,
  updatedAt: Schema.Date,
});
export type TaskRunWire = typeof TaskRunSchema.Type;

// --- TaskRunEvent wire shape ------------------------------------------------

export const TaskRunEventSchema = Schema.Struct({
  id: Schema.String,
  runId: Schema.String,
  seq: Schema.Number,
  type: TaskRunEventTypeSchema,
  payload: Schema.Record(Schema.String, Schema.Unknown),
  createdAt: Schema.Date,
});
export type TaskRunEventWire = typeof TaskRunEventSchema.Type;

// --- Tagged errors ----------------------------------------------------------

export class RunnerNotRegisteredError extends Schema.TaggedErrorClass<RunnerNotRegisteredError>()(
  "RunnerNotRegisteredError",
  { deviceId: Schema.String },
) {}

export class InvalidApiKeyForRunnerError extends Schema.TaggedErrorClass<InvalidApiKeyForRunnerError>()(
  "InvalidApiKeyForRunnerError",
  { message: Schema.String },
) {}

export class TaskRunNotClaimableError extends Schema.TaggedErrorClass<TaskRunNotClaimableError>()(
  "TaskRunNotClaimableError",
  { runId: Schema.String, reason: Schema.String },
) {}
