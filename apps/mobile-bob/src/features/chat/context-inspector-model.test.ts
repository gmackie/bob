import type { ContextPackV1 } from "@gmacko/ooda-client/v1";
import { describe, expect, it } from "vitest";

import {
  buildContextInspectorSummary,
  findLatestContextPackId,
} from "./context-inspector-model";

describe("mobile context inspector model", () => {
  it("finds the most recent context pack in the rendered timeline", () => {
    expect(
      findLatestContextPackId([
        { contextPackId: "pack-older" },
        {},
        { contextPackId: "pack-latest" },
        {},
      ]),
    ).toBe("pack-latest");
    expect(findLatestContextPackId([{}, {}])).toBeUndefined();
  });

  it("summarizes exact disclosure decisions and source participation", () => {
    const pack: ContextPackV1 = {
      id: "pack-1",
      conversationId: "conversation-1",
      provider: "grok",
      purpose: "host_turn",
      policySnapshot: {},
      createdAt: "2026-08-16T12:00:00.000Z",
      items: [
        {
          id: "venture-1",
          sourceType: "bizpulse_venture",
          sourceId: "venture-1",
          sensitivity: "personal",
          decision: "disclosed",
          reason: "Relevant venture",
          content: "Venture context",
        },
        {
          id: "task-1",
          sourceType: "bob_work_item",
          sourceId: "task-1",
          sensitivity: "personal",
          decision: "redacted",
          reason: "Partial task context",
          redaction: "Sensitive detail removed",
        },
        {
          id: "change-1",
          sourceType: "forgegraph_changeset",
          sourceId: "change-1",
          sensitivity: "sensitive",
          decision: "denied",
          reason: "Provider policy denied it",
        },
        {
          id: "venture-2",
          sourceType: "bizpulse_venture",
          sourceId: "venture-2",
          sensitivity: "personal",
          decision: "disclosed",
          reason: "Related venture",
          content: "Second venture",
        },
      ],
    };

    expect(buildContextInspectorSummary(pack)).toEqual({
      total: 4,
      disclosed: 2,
      withheld: 2,
      sources: [
        { sourceType: "bizpulse_venture", count: 2 },
        { sourceType: "bob_work_item", count: 1 },
        { sourceType: "forgegraph_changeset", count: 1 },
      ],
    });
  });
});
