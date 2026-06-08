import { describe, expect, it } from "vitest";

import { getMissionControlSections } from "../mission-control-model";

describe("mission control model", () => {
  it("keeps the Tasks dashboard centered on capacity, summary boxes, and live work", () => {
    expect(getMissionControlSections()).toEqual([
      "provider-capacity",
      "work-pipeline",
      "running-now",
    ]);
    expect(getMissionControlSections()).not.toContain("activity-feed");
  });
});
