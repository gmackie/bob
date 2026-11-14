import { describe, expect, it } from "vitest";

import { isBudgetProposalSession } from "./commit-planning-issues";

describe("isBudgetProposalSession", () => {
  it("holds drafts only for sessions a budget tier launched", () => {
    expect(isBudgetProposalSession({ intent: "breakdown", notes: "", budgetTier: "groom" })).toBe(true);
    expect(isBudgetProposalSession({ intent: "breakdown", notes: "" })).toBe(false);
    expect(isBudgetProposalSession(null)).toBe(false);
    expect(isBudgetProposalSession("budgetTier")).toBe(false);
  });
});
