import { Schema } from "effect";

const UuidString = Schema.String.pipe(
  Schema.check(
    Schema.isPattern(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    ),
  ),
);

export const UserId = UuidString.pipe(Schema.brand("UserId"));
export type UserId = typeof UserId.Type;

export const TenantId = UuidString.pipe(Schema.brand("TenantId"));
export type TenantId = typeof TenantId.Type;

export const SessionId = UuidString.pipe(Schema.brand("SessionId"));
export type SessionId = typeof SessionId.Type;

export const RunnerDeviceId = UuidString.pipe(Schema.brand("RunnerDeviceId"));
export type RunnerDeviceId = typeof RunnerDeviceId.Type;

export const TaskRunId = UuidString.pipe(Schema.brand("TaskRunId"));
export type TaskRunId = typeof TaskRunId.Type;

export const SessionSecretId = UuidString.pipe(Schema.brand("SessionSecretId"));
export type SessionSecretId = typeof SessionSecretId.Type;
