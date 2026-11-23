import { describe, expect, it } from "vitest";
import type { ServerEvent } from "@bob/ws";

import { derivePendingPermission } from "./pending-permission";

function event(eventType: string, payload: Record<string, unknown>, seq: number): ServerEvent {
  return {
    type: "event",
    sessionId: "run-1",
    seq,
    eventType: eventType as ServerEvent["eventType"],
    direction: "agent",
    payload,
    createdAt: "2026-10-07T00:00:00.000Z",
  };
}

describe("derivePendingPermission", () => {
  it("returns the newest unresolved permission request", () => {
    expect(
      derivePendingPermission([
        event("permission_request", { requestId: "old", toolName: "bash" }, 1),
        event("permission_resolved", { requestId: "old" }, 2),
        event("permission_request", { requestId: "new", toolName: "edit" }, 3),
      ]),
    ).toEqual({ requestId: "new", toolName: "edit" });
  });

  it("clears the banner once the run leaves blocked", () => {
    expect(
      derivePendingPermission([
        event("permission_request", { requestId: "req-1", toolName: "bash" }, 1),
        event("status_change", { status: "running" }, 2),
      ]),
    ).toBeNull();
  });
});
