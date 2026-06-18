// @gmacko/runner-protocol — runner wire protocol (RpcGroup + schemas + errors).
//
// Public surface:
//   - `RunnerRpc` — RpcGroup with 5 procedures (register, heartbeat,
//     claimWork, reportEvent, unregister). All except register require
//     RunnerSessionMiddleware (see @gmacko/auth) — listed in
//     `RUNNER_SESSION_REQUIRED`.
//   - Wire schemas: `TaskRunSchema`, `TaskRunEventSchema`,
//     `RunnerDeviceStatusSchema`, `TaskRunStatusSchema`,
//     `TaskRunEventTypeSchema`, `CapabilitySchema`.
//   - Tagged errors: `RunnerNotRegisteredError`,
//     `InvalidApiKeyForRunnerError`, `TaskRunNotClaimableError`.

export {
  RunnerRpc,
  RunnerRegisterRpc,
  RunnerHeartbeatRpc,
  RunnerClaimWorkRpc,
  RunnerReportEventRpc,
  RunnerUnregisterRpc,
  RUNNER_SESSION_REQUIRED,
} from "./groups/runner.js";

export {
  CapabilitySchema,
  RunnerDeviceStatusSchema,
  TaskRunStatusSchema,
  TaskRunEventTypeSchema,
  TaskRunSchema,
  TaskRunEventSchema,
  RunnerNotRegisteredError,
  InvalidApiKeyForRunnerError,
  TaskRunNotClaimableError,
} from "./schemas.js";
export type {
  Capability,
  RunnerDeviceStatus,
  TaskRunStatus,
  TaskRunEventType,
  TaskRunWire,
  TaskRunEventWire,
} from "./schemas.js";

/** Package version/phase sentinel — kept for the Task 3 smoke test. */
export const __gmackoRunnerProtocolPhase = "6g" as const;
