import { describe, expect, it } from "vitest";

import type {
  ConversationBranchV1,
  ConversationEventV1,
} from "../../contracts/v1";
import {
  rebuildConversationProjections,
  rebuildTimelineProjection,
} from "../projections";

const occurredAt = "2026-08-05T18:00:00.000Z";

const branches: ConversationBranchV1[] = [
  {
    id: "main",
    conversationId: "conversation-1",
    name: "main",
    createdAt: occurredAt,
    updatedAt: occurredAt,
  },
  {
    id: "branch",
    conversationId: "conversation-1",
    parentBranchId: "main",
    forkEventId: "event-2",
    name: "branch",
    createdAt: occurredAt,
    updatedAt: occurredAt,
  },
];

function event(
  id: string,
  sequence: number,
  branchId: string,
  type: ConversationEventV1["type"],
  payload: Record<string, unknown>,
): ConversationEventV1 {
  return {
    id,
    conversationId: "conversation-1",
    branchId,
    sequence: String(sequence),
    type,
    actor: { type: type === "user_turn" ? "user" : "host" },
    payload,
    sensitivity: "general",
    correlationId: "projection-test",
    occurredAt,
  };
}

const events: ConversationEventV1[] = [
  event("event-1", 1, "main", "user_turn", { display: "recpie idea" }),
  event("event-2", 2, "main", "assistant_turn", { display: "Tell me more" }),
  event("event-3", 3, "main", "assistant_turn", { display: "Main-only reply" }),
  event("event-4", 4, "branch", "correction", {
    correctedEventId: "event-1",
    replacementPayload: { display: "recipe idea" },
    reason: "Speech recognition typo",
  }),
  event("event-5", 5, "branch", "proposal", { display: "Save recipe note" }),
  event("event-6", 6, "main", "failure", { display: "Main-only failure" }),
];

describe("conversation projections", () => {
  it("rebuilds a branch timeline from ancestry and immutable corrections", () => {
    const timeline = rebuildTimelineProjection({
      branches,
      events,
      targetBranchId: "branch",
    });

    expect(timeline.map((item) => item.event.sequence)).toEqual(["1", "2", "4", "5"]);
    expect(timeline[0]).toMatchObject({
      effectivePayload: { display: "recipe idea" },
      correctedByEventId: "event-4",
    });
    expect(timeline[0]?.event.payload).toEqual({ display: "recpie idea" });
  });

  it("is deterministic regardless of input row order", () => {
    const first = rebuildConversationProjections({
      branches,
      events,
      targetBranchId: "branch",
    });
    const second = rebuildConversationProjections({
      branches: [...branches].reverse(),
      events: [...events].reverse(),
      targetBranchId: "branch",
    });

    expect(second).toEqual(first);
    expect(first.search.items.map((item) => item.text)).toEqual([
      "recipe idea",
      "Tell me more",
    ]);
    expect(first.inbox.items).toHaveLength(1);
    expect(first.dailyReview.items.map((item) => item.eventId)).toEqual(["event-5"]);
    expect(first.activeWork.items.map((item) => item.eventId)).toEqual(["event-5"]);
  });

  it("rejects an invalid event sequence instead of building ambiguous state", () => {
    expect(() =>
      rebuildTimelineProjection({
        branches,
        events: [...events, event("duplicate", 5, "branch", "user_turn", {})],
        targetBranchId: "branch",
      }),
    ).toThrow(/duplicate sequence/i);
  });
});
