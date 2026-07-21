import { describe, expect, it } from "vitest";

import {
  getCustomerOnboardingHref,
  getCustomerOnboardingStepHref,
  getCustomerOnboardingStepNumber,
  getCustomerOnboardingSteps,
} from "../customer-onboarding-model";

describe("customer onboarding model", () => {
  it("guides customers through the required startup sequence", () => {
    expect(getCustomerOnboardingSteps().map((step) => step.key)).toEqual([
      "github-auth",
      "workspace",
      "repo-import",
      "forgegraph-token",
      "daemon",
      "first-task-run",
    ]);
  });

  it("links every checklist step to the existing setup surface", () => {
    expect(getCustomerOnboardingSteps().map((step) => step.href)).toEqual([
      "/settings?section=git-providers",
      "/planning",
      "/planning/projects",
      "/settings?section=git-providers",
      "/nodes",
      "/tasks/queue",
    ]);
  });

  it("preserves workspace context only for workspace-scoped steps", () => {
    const steps = getCustomerOnboardingSteps();

    expect(getCustomerOnboardingHref("workspace-1")).toBe(
      "/onboarding?workspace=workspace-1",
    );
    expect(getCustomerOnboardingStepHref(steps[1]!, "workspace-1")).toBe(
      "/planning?workspace=workspace-1",
    );
    expect(getCustomerOnboardingStepHref(steps[2]!, "workspace-1")).toBe(
      "/planning/projects?workspace=workspace-1",
    );
    expect(getCustomerOnboardingStepHref(steps[3]!, "workspace-1")).toBe(
      "/settings?section=git-providers",
    );
    expect(getCustomerOnboardingStepHref(steps[5]!, "workspace-1")).toBe(
      "/tasks/queue?workspace=workspace-1",
    );
  });

  it("formats step numbers for checklist display", () => {
    expect(getCustomerOnboardingStepNumber(0)).toBe("01");
    expect(getCustomerOnboardingStepNumber(5)).toBe("06");
  });
});
