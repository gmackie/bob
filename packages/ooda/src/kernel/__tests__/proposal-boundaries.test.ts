import { describe, expect, it } from "vitest";

import type { CreateProposalInputV1 } from "../../contracts/v1";
import { validateProposalBoundary } from "../proposals";

function obsidian(preview: Record<string, unknown>): CreateProposalInputV1 {
  return {
    conversationId: "conversation-1",
    kind: "obsidian_note",
    destination: "obsidian",
    risk: "private_write",
    preview,
    rationale: "Curate this note.",
    confidence: 0.9,
    policySnapshot: { version: "v1" },
    idempotencyKey: "proposal-obsidian-1",
  };
}

describe("proposal boundaries", () => {
  it("requires the exact Obsidian path and content before approval", () => {
    expect(() =>
      validateProposalBoundary(
        obsidian({
          path: "Captures/2026-08-08 - OODA.md",
          title: "OODA",
          content: "# OODA\n",
        }),
      ),
    ).not.toThrow();
    expect(() => validateProposalBoundary(obsidian({ title: "OODA" }))).toThrow(
      /exact path and content/i,
    );
  });
});
