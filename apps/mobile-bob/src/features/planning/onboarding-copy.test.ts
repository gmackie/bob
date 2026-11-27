import { describe, expect, it } from "vitest";

import { ONBOARDING_SLIDES } from "./onboarding-copy";

describe("onboarding copy", () => {
  it("pairs each step with its own workshop illustration in reading order", () => {
    expect(ONBOARDING_SLIDES.map((slide) => slide.scene)).toEqual([
      "plan",
      "work",
      "ship",
    ]);
  });

  it("uses execution workspace language in the mobile onboarding flow", () => {
    expect(ONBOARDING_SLIDES[1].bullets).toContain(
      "Jump directly into the execution workspace from mobile",
    );
    expect(ONBOARDING_SLIDES[1].bullets.join(" ")).not.toContain(
      "task workspace",
    );
  });
});
