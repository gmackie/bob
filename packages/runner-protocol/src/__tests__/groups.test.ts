// Phase 6G Task 5 — RunnerRpc group composition.
//
// Verifies (pure metadata, no handlers):
//   1) RpcGroup composition resolves all 5 procedures by tag.
//   2) None of the runner procedures are streaming — the runner protocol
//      is strictly request/response. Detected via
//      `RpcSchema.isStreamSchema(rpc.successSchema)`.
//   3) The exported `RUNNER_SESSION_REQUIRED` manifest correctly lists the
//      4 procedures that need the X-Runner-Session header (i.e.
//      everything EXCEPT `runner.register`).
import { describe, expect, it } from "vitest";
import { RpcSchema } from "effect/unstable/rpc";

import {
  RUNNER_SESSION_REQUIRED,
  RunnerClaimWorkRpc,
  RunnerHeartbeatRpc,
  RunnerRegisterRpc,
  RunnerReportEventRpc,
  RunnerRpc,
  RunnerUnregisterRpc,
} from "../groups/runner.js";

describe("RunnerRpc group composition", () => {
  it("resolves all 5 procedures by tag", () => {
    const tags = Array.from(RunnerRpc.requests.keys());
    expect(tags.sort()).toEqual(
      [
        "runner.register",
        "runner.heartbeat",
        "runner.claimWork",
        "runner.reportEvent",
        "runner.unregister",
      ].sort(),
    );

    // Sanity-check: the individual Rpc values are present in the group.
    expect(RunnerRpc.requests.get("runner.register")).toBe(RunnerRegisterRpc);
    expect(RunnerRpc.requests.get("runner.heartbeat")).toBe(RunnerHeartbeatRpc);
    expect(RunnerRpc.requests.get("runner.claimWork")).toBe(RunnerClaimWorkRpc);
    expect(RunnerRpc.requests.get("runner.reportEvent")).toBe(
      RunnerReportEventRpc,
    );
    expect(RunnerRpc.requests.get("runner.unregister")).toBe(
      RunnerUnregisterRpc,
    );
  });

  it("declares all 5 procedures as non-streaming (request/response only)", () => {
    // `stream: true` would wrap successSchema in `RpcSchema.Stream<...>`;
    // the runner protocol intentionally never does this.
    expect(RpcSchema.isStreamSchema(RunnerRegisterRpc.successSchema)).toBe(
      false,
    );
    expect(RpcSchema.isStreamSchema(RunnerHeartbeatRpc.successSchema)).toBe(
      false,
    );
    expect(RpcSchema.isStreamSchema(RunnerClaimWorkRpc.successSchema)).toBe(
      false,
    );
    expect(RpcSchema.isStreamSchema(RunnerReportEventRpc.successSchema)).toBe(
      false,
    );
    expect(RpcSchema.isStreamSchema(RunnerUnregisterRpc.successSchema)).toBe(
      false,
    );
  });
});

describe("RUNNER_SESSION_REQUIRED manifest", () => {
  it("lists the 4 session-gated procedures and excludes runner.register", () => {
    expect(RUNNER_SESSION_REQUIRED).toEqual([
      "runner.heartbeat",
      "runner.claimWork",
      "runner.reportEvent",
      "runner.unregister",
    ]);
    // `runner.register` is public (authenticated by apiKeyBearer only).
    expect(RUNNER_SESSION_REQUIRED).not.toContain("runner.register");
  });
});
