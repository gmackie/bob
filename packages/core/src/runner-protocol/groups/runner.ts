// Phase 6G Task 5 — RunnerRpc group: 5 procedures over HTTP RPC.
//
// All procedures except `runner.register` require a valid X-Runner-Session
// header (RunnerSessionMiddleware in @gmacko/auth). `register` is public,
// authenticated by apiKeyBearer in the payload — server validates against
// @gmacko/auth's ApiKeys service and mints a session token in response.
//
// Procedures are strictly request/response (no streaming). Heartbeat / claim
// loops live in @gmacko/runner-base, not in the wire protocol.
import { Schema } from "effect";
import { Rpc, RpcGroup } from "effect/unstable/rpc";

import {
  CapabilitySchema,
  InvalidApiKeyForRunnerError,
  RunnerDeviceStatusSchema,
  RunnerNotRegisteredError,
  TaskRunEventTypeSchema,
  TaskRunNotClaimableError,
  TaskRunSchema,
} from "../schemas.js";

// --- Procedures ---

export const RunnerRegisterRpc = Rpc.make("runner.register", {
  payload: Schema.Struct({
    hostname: Schema.String,
    capabilities: Schema.Array(CapabilitySchema),
    apiKeyBearer: Schema.String,
  }),
  success: Schema.Struct({
    deviceId: Schema.String,
    sessionToken: Schema.String,
    expiresAt: Schema.Date,
    serverTime: Schema.Date,
  }),
  error: InvalidApiKeyForRunnerError,
});

// `RunnerDeviceStatusSchema` includes "offline" which a runner never sets
// from inside heartbeat — only the server marks devices offline on staleness.
// Restrict the heartbeat status to the runner-reportable subset.
const HeartbeatStatusSchema = Schema.Literals(["idle", "busy", "draining"]);

export const RunnerHeartbeatRpc = Rpc.make("runner.heartbeat", {
  payload: Schema.Struct({
    status: HeartbeatStatusSchema,
  }),
  success: Schema.Struct({
    serverTime: Schema.Date,
  }),
  error: RunnerNotRegisteredError,
});

export const RunnerClaimWorkRpc = Rpc.make("runner.claimWork", {
  payload: Schema.Struct({
    capabilityFilter: Schema.Array(CapabilitySchema),
  }),
  // Option<TaskRun> encoded as nullable on the wire.
  success: Schema.NullOr(TaskRunSchema),
  error: RunnerNotRegisteredError,
});

export const RunnerReportEventRpc = Rpc.make("runner.reportEvent", {
  payload: Schema.Struct({
    runId: Schema.String,
    type: TaskRunEventTypeSchema,
    payload: Schema.Unknown,
    seq: Schema.optional(Schema.Number),
  }),
  success: Schema.Void,
  error: Schema.Union([RunnerNotRegisteredError, TaskRunNotClaimableError]),
});

export const RunnerUnregisterRpc = Rpc.make("runner.unregister", {
  payload: Schema.Struct({
    reason: Schema.optional(Schema.String),
  }),
  success: Schema.Void,
  error: RunnerNotRegisteredError,
});

// --- Group ---

export const RunnerRpc = RpcGroup.make(
  RunnerRegisterRpc,
  RunnerHeartbeatRpc,
  RunnerClaimWorkRpc,
  RunnerReportEventRpc,
  RunnerUnregisterRpc,
);

// --- Middleware requirements manifest ---

/**
 * Procedures that require a valid X-Runner-Session header
 * (RunnerSessionMiddleware in @gmacko/auth). `runner.register` is
 * deliberately NOT in this set — it's authenticated only by apiKeyBearer
 * in the payload, and the server's response is what mints the session.
 */
export const RUNNER_SESSION_REQUIRED = [
  "runner.heartbeat",
  "runner.claimWork",
  "runner.reportEvent",
  "runner.unregister",
] as const;
