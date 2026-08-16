import type { ConversationEventV1 } from "@gmacko/ooda-client/v1";
import { describe, expect, it } from "vitest";

import type { OodaTimelineItem } from "./ooda-timeline";
import {
  buildForkConversationInput,
  findLatestForkPoint,
} from "./conversation-branch-model";

function event(id: string, sequence: string): ConversationEventV1 {
  return {
    id,
    conversationId: "conversation-1",
    branchId: "branch-main",
    sequence,
    type: "assistant_turn",
    actor: { type: "host" },
    payload: { display: id },
    sensitivity: "general",
    correlationId: id,
    occurredAt: "2026-08-16T18:00:00.000Z",
  };
}

describe("mobile conversation branching model", () => {
  it("forks from the latest durable event and ignores queued local turns", () => {
    const first = event("event-1", "1");
    const latest = event("event-2", "2");
    const timeline = [
      { id: "one", kind: "system", event: first },
      { id: "pending", kind: "message" },
      { id: "two", kind: "message", event: latest },
    ] as OodaTimelineItem[];
    expect(findLatestForkPoint(timeline)).toEqual({
      eventId: "event-2",
      branchId: "branch-main",
    });
  });

  it("returns no branch point before any durable event exists", () => {
    expect(
      findLatestForkPoint([
        { id: "pending", kind: "message" },
      ] as OodaTimelineItem[]),
    ).toBeUndefined();
  });

  it("builds a trimmed, idempotent fork command with optional reason", () => {
    expect(
      buildForkConversationInput({
        conversationId: "conversation-1",
        parentBranchId: "branch-main",
        forkEventId: "event-2",
        name: "  Different approach  ",
        reason: "  Compare a smaller scope  ",
        idempotencyKey: "fork-device-1",
      }),
    ).toEqual({
      conversationId: "conversation-1",
      parentBranchId: "branch-main",
      forkEventId: "event-2",
      name: "Different approach",
      reason: "Compare a smaller scope",
      idempotencyKey: "fork-device-1",
    });
    expect(
      buildForkConversationInput({
        conversationId: "conversation-1",
        parentBranchId: "branch-main",
        forkEventId: "event-2",
        name: "Alternative",
        reason: "   ",
        idempotencyKey: "fork-device-2",
      }),
    ).not.toHaveProperty("reason");
  });
});
