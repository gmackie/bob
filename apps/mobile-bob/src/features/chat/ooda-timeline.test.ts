import { describe, expect, it } from "vitest";

import type { ConversationEventV1 } from "@gmacko/ooda-client/v1";

import type { OodaOutboxItem } from "./ooda-outbox";
import { buildOodaTimeline } from "./ooda-timeline";

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
    occurredAt: `2026-08-06T12:00:${String(sequence).padStart(2, "0")}.000Z`,
  };
}

function queued(id: string, text: string, status: OodaOutboxItem["status"]): OodaOutboxItem {
  return {
    id,
    conversationId: "conversation-1",
    branchId: "branch-1",
    idempotencyKey: id,
    status,
    attempts: status === "queued" ? 0 : 1,
    error: status === "failed" ? "offline" : undefined,
    createdAt: "2026-08-06T12:01:00.000Z",
    updatedAt: "2026-08-06T12:01:01.000Z",
    input: {
      conversationId: "conversation-1",
      branchId: "branch-1",
      type: "user_turn",
      actor: { type: "user" },
      payload: { display: text },
      sensitivity: "personal",
      correlationId: `correlation-${id}`,
      idempotencyKey: id,
      occurredAt: "2026-08-06T12:01:00.000Z",
    },
  };
}

describe("canonical OODA timeline", () => {
  it("maps the heterogeneous canonical events into typed render items", () => {
    const result = buildOodaTimeline([
      event("user", 1, "user_turn", { display: "Research this" }, { type: "user" }),
      event("host", 2, "assistant_turn", {
        display: "Here is the full answer",
        speakable: "Here is the short answer",
        contextPackId: "context-pack-1",
      }, { type: "host", id: "grok" }),
      event("tool", 3, "tool_call", { name: "web.search", status: "running" }, { type: "worker" }),
      event("citation", 4, "citation", { title: "Primary source", url: "https://example.test/source" }),
      event("proposal", 5, "proposal", { proposalId: "proposal-1", kind: "bob_project", status: "awaiting_approval", rationale: "Worth testing" }),
      event("job", 6, "agent_job_progress", { jobId: "job-1", status: "running", summary: "Comparing sources" }),
      event("evidence", 7, "external_evidence", { title: "ForgeGraph build", status: "passed", url: "https://forge.example.test/build" }),
      event("failure", 8, "failure", { detail: "Provider unavailable" }),
    ]);

    expect(result.map((item) => item.kind)).toEqual([
      "message",
      "message",
      "tool",
      "citation",
      "proposal",
      "job",
      "evidence",
      "system",
    ]);
    expect(result[0]).toMatchObject({ kind: "message", role: "user", display: "Research this" });
    expect(result[1]).toMatchObject({
      kind: "message",
      role: "assistant",
      speakable: "Here is the short answer",
      contextPackId: "context-pack-1",
    });
    expect(result[4]).toMatchObject({ kind: "proposal", proposalId: "proposal-1", status: "awaiting_approval" });
    expect(result[7]).toMatchObject({ kind: "system", tone: "error", display: "Provider unavailable" });
  });

  it("applies the latest immutable correction without rendering a duplicate turn", () => {
    const result = buildOodaTimeline([
      event("user", 1, "user_turn", { display: "recpie idea" }, { type: "user" }),
      event("correction-1", 2, "correction", {
        correctedEventId: "user",
        replacementPayload: { display: "recipe idea" },
      }, { type: "user" }),
      event("correction-2", 3, "correction", {
        correctedEventId: "user",
        replacementPayload: { display: "high-protein recipe idea" },
      }, { type: "user" }),
    ]);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      kind: "message",
      display: "high-protein recipe idea",
      corrected: true,
    });
  });

  it("shows optimistic delivery state and removes it after the canonical idempotency key arrives", () => {
    const pending = queued("device-event", "Survive airplane mode", "syncing");

    expect(buildOodaTimeline([], [pending])).toMatchObject([
      {
        id: "pending:device-event",
        kind: "message",
        role: "user",
        display: "Survive airplane mode",
        deliveryState: "syncing",
      },
    ]);

    const canonical = event("server-event", 1, "user_turn", {
      display: "Survive airplane mode",
    }, { type: "user" });
    canonical.idempotencyKey = "device-event";
    const reconciled = buildOodaTimeline([canonical], [pending]);

    expect(reconciled).toHaveLength(1);
    expect(reconciled[0]).toMatchObject({ id: "event:server-event", deliveryState: "synced" });
  });

  it("sorts server events numerically and appends pending turns in capture order", () => {
    const result = buildOodaTimeline([
      event("ten", 10, "assistant_turn", { display: "Ten" }, { type: "host" }),
      event("two", 2, "user_turn", { display: "Two" }, { type: "user" }),
    ], [
      queued("pending", "Pending", "failed"),
    ]);

    expect(result.map((item) => item.display)).toEqual(["Two", "Ten", "Pending"]);
    expect(result[2]).toMatchObject({ deliveryState: "failed", error: "offline" });
  });

  it("projects branch ancestry only through each fork point", () => {
    const rootBefore = event("root-before", 1, "user_turn", { display: "Shared" }, { type: "user" });
    const forkPoint = event("fork-point", 2, "assistant_turn", { display: "Fork here" }, { type: "host" });
    const childTurn = event("child", 3, "user_turn", { display: "Child path" }, { type: "user" });
    childTurn.branchId = "branch-child";
    const rootAfter = event("root-after", 4, "user_turn", { display: "Root path" }, { type: "user" });
    const branches = [
      {
        id: "branch-1",
        conversationId: "conversation-1",
        name: "main",
        createdAt: "2026-08-06T12:00:00.000Z",
        updatedAt: "2026-08-06T12:00:00.000Z",
      },
      {
        id: "branch-child",
        conversationId: "conversation-1",
        parentBranchId: "branch-1",
        forkEventId: "fork-point",
        name: "alternate",
        reason: "Try another angle",
        createdAt: "2026-08-06T12:00:03.000Z",
        updatedAt: "2026-08-06T12:00:03.000Z",
      },
    ];

    const child = buildOodaTimeline(
      [rootBefore, forkPoint, childTurn, rootAfter],
      [],
      { branches, targetBranchId: "branch-child" },
    );

    expect(child.map((item) => item.display)).toEqual(["Shared", "Fork here", "Child path"]);
  });
});
