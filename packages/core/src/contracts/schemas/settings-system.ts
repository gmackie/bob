// Wire-format schemas for the settings.system.* procedures.
//
// `system.health` is public (no auth required); `system.status` is protected
// and returns metrics about the user's resource usage.
import { Schema } from "effect";

// --- System health -----------------------------------------------------------

export const SystemHealthSchema = Schema.Struct({
  status: Schema.Literals(["ok", "degraded", "error"]),
  timestamp: Schema.String, // ISO-8601 string (not DateTimeUtc — lightweight probe)
});
export type SystemHealthWire = typeof SystemHealthSchema.Type;

// --- System status (authenticated) -------------------------------------------

export const SystemMemorySchema = Schema.Struct({
  rss: Schema.Number,
  heapTotal: Schema.Number,
  heapUsed: Schema.Number,
  external: Schema.Number,
});

export const SystemMetricsSchema = Schema.Struct({
  repositories: Schema.Number,
  worktrees: Schema.Number,
  totalInstances: Schema.Number,
  activeInstances: Schema.Number,
});

export const SystemGitHubStatusSchema = Schema.Struct({
  status: Schema.Literals(["unknown", "connected", "error"]),
  version: Schema.String,
  user: Schema.String,
});

export const SystemServerSchema = Schema.Struct({
  uptime: Schema.Number,
  memory: SystemMemorySchema,
  nodeVersion: Schema.String,
});

export const SystemStatusSchema = Schema.Struct({
  agents: Schema.Array(Schema.Unknown),
  github: SystemGitHubStatusSchema,
  metrics: SystemMetricsSchema,
  server: SystemServerSchema,
});
export type SystemStatusWire = typeof SystemStatusSchema.Type;
