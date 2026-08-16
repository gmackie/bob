import { describe, expect, it } from "vitest";

import {
  agentJobResultPreviewV1,
  buildConversationResearchJobInputV1,
  canAutomaticallyResearchSensitivityV1,
} from "./research";

describe("conversation research commands", () => {
  it("requires explicit approval for sensitive provider disclosure", () => {
    expect(canAutomaticallyResearchSensitivityV1("general")).toBe(true);
    expect(canAutomaticallyResearchSensitivityV1("personal")).toBe(true);
    expect(canAutomaticallyResearchSensitivityV1("sensitive")).toBe(false);
    expect(canAutomaticallyResearchSensitivityV1("restricted")).toBe(false);
  });

  it("builds one bounded read-only job without client-selected runtime policy", () => {
    expect(
      buildConversationResearchJobInputV1({
        conversationId: "conversation-1",
        eventId: "event-1",
        role: "assistant",
        body: " Compare the implementation evidence. ",
        sensitivity: "personal",
        correlationId: "turn-1",
        idempotencyKey: "research-1",
      }),
    ).toEqual({
      conversationId: "conversation-1",
      sourceEventId: "event-1",
      class: "read_only_research",
      prompt: [
        "Research the following durable OODA conversation excerpt. Return concise findings, uncertainty, and source links. Do not modify repositories or external systems.",
        "Source role: assistant\nSource event: event-1",
        "Compare the implementation evidence.",
      ].join("\n\n"),
      correlationId: "turn-1",
      idempotencyKey: "research-1",
    });
  });

  it("rejects blank excerpts and bounds accepted excerpts", () => {
    expect(() =>
      buildConversationResearchJobInputV1({
        conversationId: "conversation-1",
        eventId: "event-1",
        role: "user",
        body: "   ",
        sensitivity: "general",
        idempotencyKey: "research-blank",
      }),
    ).toThrow("Research excerpt is required");
    const command = buildConversationResearchJobInputV1({
      conversationId: "conversation-1",
      eventId: "event-1",
      role: "user",
      body: "x".repeat(60_000),
      sensitivity: "personal",
      idempotencyKey: "research-large",
    });
    expect(command.prompt.length).toBeLessThan(51_000);
    expect(() =>
      buildConversationResearchJobInputV1({
        conversationId: "conversation-1",
        eventId: "event-sensitive",
        role: "user",
        body: "Do not disclose this automatically.",
        sensitivity: "sensitive",
        idempotencyKey: "research-sensitive",
      }),
    ).toThrow("Sensitive research requires explicit disclosure approval");
  });

  it("prefers completed findings and truncates activity previews", () => {
    expect(
      agentJobResultPreviewV1(
        {
          id: "job-1",
          conversationId: "conversation-1",
          class: "read_only_research",
          status: "completed",
          provider: "codex",
          billingPolicy: "subscription_only",
          capabilities: [],
          budget: { deadlineSeconds: 900, aggregateTokens: 150_000 },
          result: { response: "evidence ".repeat(1_000) },
          createdAt: "2026-08-16T19:00:00.000Z",
          updatedAt: "2026-08-16T19:05:00.000Z",
        },
        80,
      ),
    ).toMatch(/^evidence .*…$/);
    expect(
      agentJobResultPreviewV1({
        id: "job-2",
        conversationId: "conversation-1",
        class: "read_only_research",
        status: "running",
        provider: "codex",
        billingPolicy: "subscription_only",
        capabilities: [],
        budget: { deadlineSeconds: 900, aggregateTokens: 150_000 },
        createdAt: "2026-08-16T19:00:00.000Z",
        updatedAt: "2026-08-16T19:01:00.000Z",
      }),
    ).toBeUndefined();
  });
});
