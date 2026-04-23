// @gmacko/runner-protocol — runner wire protocol (RpcGroup + schemas + errors).
//
// Real exports (RunnerRpc, TaskRunSchema, TaskRunEventSchema, tagged errors)
// land in Tasks 4-6 of Phase 6G. This file currently carries only a version
// sentinel so the Task 3 smoke test can prove the package resolves.
export const __gmackoRunnerProtocolPhase = "6g" as const;
