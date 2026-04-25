// @gmacko/runner-base — runner runtime: register→heartbeat→claim→dispatch loop
// with exponential-jittered retries and SIGTERM drain.
//
// Public surface:
//   - `RunnerRuntime` / `layerRunnerRuntime` — Effect service for managing
//     a runner's connection lifecycle (start, set status, query status,
//     register work handlers).
//   - `WorkHandler` — type for capability handlers; receives runId,
//     capability, input, and an emit() function for reporting events.
//   - `retrySchedule` / `withRetry` — the gmacko-standard retry policy
//     (exponential backoff with jitter, capped at 5 retries) reusable by
//     consumers building their own server calls.
//   - `RuntimeStartError` — tagged error for register failures.
//
// Runners are server-to-server infrastructure. The MockServer test harness
// is intentionally NOT exported as a public subpath in 6G — it's inlined in
// the integration tests. If a consumer wants their own runner test harness,
// they can copy the pattern from packages/runner-base/src/__tests__/.

export {
  RunnerRuntime,
  RuntimeStartError,
  layerRunnerRuntime,
} from "./runtime.js";
export type {
  RunnerRuntimeShape,
  RunnerStatus,
  StartOptions,
  WorkHandler,
} from "./runtime.js";

export { retrySchedule, withRetry } from "./retry.js";

/** Package version/phase sentinel — kept for the Task 7 smoke test. */
export const __gmackoRunnerBasePhase = "6g" as const;
