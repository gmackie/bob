import { describe, expect, it } from "vitest";

import type { ConversationEventV1 } from "@gmacko/ooda/contracts/v1";

import { buildConversationTimelineView } from "./view-models";

function event(
  id: string,
  sequence: number,
  type: ConversationEventV1["type"],
  payload: Record<string, unknown>,
  actor: ConversationEventV1["actor"] = { type: "system" },
): ConversationEventV1 {
  return {
    id,
    conversationId: "conversation-1",
    branchId: "branch-1",
    sequence: String(sequence),
    type,
    actor,
    payload,
    sensitivity: "personal",
    correlationId: `correlation-${id}`,
    occurredAt: `2026-08-09T16:00:${String(sequence).padStart(2, "0")}.000Z`,
  };
}

describe("conversation timeline view model", () => {
  it("projects heterogeneous canonical events for web and mobile renderers", () => {
    const items = buildConversationTimelineView([
      event(
        "user",
        1,
        "user_turn",
        { display: "Research this" },
        { type: "user" },
      ),
      event(
        "assistant",
        2,
        "assistant_turn",
        {
          display: "Full answer",
          speakable: "Short answer",
          contextPackId: "pack-1",
        },
        { type: "host", id: "grok" },
      ),
      event("tool", 3, "tool_call", { name: "web.search", status: "running" }),
      event("citation", 4, "citation", {
        title: "Primary source",
        url: "https://example.test/source",
      }),
      event("proposal", 5, "proposal", {
        proposalId: "proposal-1",
        kind: "bob_project",
        status: "awaiting_approval",
        rationale: "Worth testing",
      }),
      event("job", 6, "agent_job_progress", {
        jobId: "job-1",
        status: "running",
        summary: "Comparing",
      }),
      event("evidence", 7, "delivery", {
        receipt: {
          status: "accepted",
          deepLink: "https://bob.example/project/1",
        },
      }),
      event("failure", 8, "failure", { detail: "Provider unavailable" }),
    ]);

    expect(items.map((item) => item.kind)).toEqual([
      "message",
      "message",
      "tool",
      "citation",
      "proposal",
      "job",
      "evidence",
      "system",
    ]);
    expect(items[1]).toMatchObject({
      role: "assistant",
      body: "Full answer",
      speakable: "Short answer",
      contextPackId: "pack-1",
    });
    expect(items[4]).toMatchObject({
      proposalId: "proposal-1",
      status: "awaiting_approval",
    });
    expect(items[6]).toMatchObject({
      href: "https://bob.example/project/1",
      status: "accepted",
    });
  });

  it("applies the latest correction and collapses unfinished assistant deltas", () => {
    const firstDelta = event(
      "delta-1",
      3,
      "assistant_delta",
      { delta: "Working " },
      { type: "host" },
    );
    firstDelta.correlationId = "host-turn-1";
    const secondDelta = event(
      "delta-2",
      4,
      "assistant_delta",
      { delta: "through it" },
      { type: "host" },
    );
    secondDelta.correlationId = "host-turn-1";

    const items = buildConversationTimelineView([
      event(
        "user",
        1,
        "user_turn",
        { display: "recpie idea" },
        { type: "user" },
      ),
      event("correction", 2, "correction", {
        correctedEventId: "user",
        replacementPayload: { display: "recipe idea" },
      }),
      firstDelta,
      secondDelta,
    ]);

    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ body: "recipe idea", corrected: true });
    expect(items[1]).toMatchObject({
      body: "Working through it",
      streaming: true,
    });
  });
});
