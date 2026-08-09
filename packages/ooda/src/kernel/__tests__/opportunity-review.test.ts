import { describe, expect, it } from "vitest";

import { scoreOpportunityReview } from "../opportunity-reviews";

const strong = {
  expectedValue: 0.9,
  strategicFit: 0.9,
  evidence: 0.8,
  timing: 0.8,
  crossProjectSynergy: 0.85,
  energyInterestFit: 0.9,
  reversibilityLearningValue: 0.9,
  opportunityCost: 0.2,
};

describe("scoreOpportunityReview", () => {
  it("uses the constitutional weights and opportunity-cost penalty", () => {
    expect(scoreOpportunityReview(strong, {
      activeVentureExperiments: 1,
      majorImplementationStreams: 1,
    })).toEqual({ score: 0.82, recommendation: "propose" });
  });

  it("incubates an otherwise strong idea when portfolio capacity is full", () => {
    expect(scoreOpportunityReview(strong, {
      activeVentureExperiments: 3,
      majorImplementationStreams: 2,
    })).toMatchObject({ recommendation: "incubate" });
  });

  it("can recommend killing a low-value high-cost distraction", () => {
    expect(scoreOpportunityReview({
      expectedValue: 0.1,
      strategicFit: 0.05,
      evidence: 0.1,
      timing: 0.1,
      crossProjectSynergy: 0,
      energyInterestFit: 0.1,
      reversibilityLearningValue: 0.1,
      opportunityCost: 1,
    }, {
      activeVentureExperiments: 0,
      majorImplementationStreams: 0,
    })).toMatchObject({ recommendation: "kill" });
  });

  it("prefers merge when a duplicate memory is explicitly identified", () => {
    expect(scoreOpportunityReview(strong, {
      activeVentureExperiments: 1,
      majorImplementationStreams: 0,
    }, { duplicateMemoryId: "memory-existing" })).toMatchObject({
      recommendation: "merge",
    });
  });
});
