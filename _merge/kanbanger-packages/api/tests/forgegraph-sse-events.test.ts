import { describe, expect, it } from "vitest";
import { SSE_EVENTS } from "@linear-clone/realtime/sse-server";
import { buildForgeRunSsePayload } from "../src/routers/forge-run";

describe("ForgeGraph SSE events", () => {
  it("exposes ForgeGraph SSE event constants", () => {
    expect(SSE_EVENTS.FORGE_REVISION_INDEXED).toBe("forge:revision_indexed");
    expect(SSE_EVENTS.FORGE_RUN_OVERLAY_UPDATED).toBe("forge:run_overlay_updated");
  });

  it("builds run overlay payload", () => {
    const payload = buildForgeRunSsePayload({
      runId: "run-1",
      repoId: "repo-1",
      revId: "rev-1",
      status: "tests_finished",
      testStatus: "pass",
    });

    expect(payload.runId).toBe("run-1");
    expect(payload.repoId).toBe("repo-1");
    expect(payload.revId).toBe("rev-1");
    expect(payload.status).toBe("tests_finished");
    expect(payload.testStatus).toBe("pass");
    expect(typeof payload.updatedAt).toBe("string");
  });
});
