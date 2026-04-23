// @gmacko/runner-base — runner runtime: register→heartbeat→claim→dispatch loop
// with exponential-jittered retries and SIGTERM drain.
//
// Real exports (RunnerRuntime, layerRunnerRuntime, WorkHandler, retrySchedule,
// MockServer under ./testing) land in Tasks 8-14 of Phase 6G. This file
// currently carries only a version sentinel.
export const __gmackoRunnerBasePhase = "6g" as const;
