import { Schema } from "effect";

const UuidString = Schema.String.pipe(
  Schema.check(
    Schema.isPattern(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    ),
  ),
);

// UserId is NOT a UUID: better-auth generates opaque string ids
// (e.g. "user_abc123"). We only require a non-empty string + brand.
export const UserId = Schema.String.pipe(
  Schema.check(Schema.isMinLength(1)),
).pipe(Schema.brand("UserId"));
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

export const ApiKeyId = UuidString.pipe(Schema.brand("ApiKeyId"));
export type ApiKeyId = typeof ApiKeyId.Type;

export const DeviceCodeId = UuidString.pipe(Schema.brand("DeviceCodeId"));
export type DeviceCodeId = typeof DeviceCodeId.Type;

export const ProjectId = UuidString.pipe(Schema.brand("ProjectId"));
export type ProjectId = typeof ProjectId.Type;

// Tenant membership role enum. Used by CurrentUser (rpc) and Tenancy service.
export const TenantMemberRole = Schema.Literals(["owner", "admin", "member"]);
export type TenantMemberRole = typeof TenantMemberRole.Type;
