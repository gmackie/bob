import { describe, expect, it } from "vitest";

import { buildLifecycleEvent } from "../lifecycleEvents";

describe("lifecycleEvents", () => {
  it("builds a valid event object", () => {
    const event = buildLifecycleEvent({
      taskRunId: "run-1",
      workItemId: "wi-1",
      sessionId: "session-1",
      eventType: "run_started",
      phase: "shape",
    });

    expect(event.taskRunId).toBe("run-1");
    expect(event.eventType).toBe("run_started");
    expect(event.phase).toBe("shape");
    expect(event.metadata).toEqual({});
  });

  it("includes metadata when provided", () => {
    const event = buildLifecycleEvent({
      taskRunId: "run-1",
      eventType: "artifact_created",
      phase: "shape",
      metadata: { artifactType: "brd", title: "Feature BRD" },
    });

    expect(event.metadata).toEqual({ artifactType: "brd", title: "Feature BRD" });
  });
});
