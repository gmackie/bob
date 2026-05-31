import { describe, expect, it } from "vitest";

import {
  getTabletDashboardHref,
  getTabletDashboardSelectionReset,
} from "./navigation";

describe("tablet navigation", () => {
  it("returns to the planning dashboard and clears detail selection", () => {
    expect(getTabletDashboardHref()).toBe("/planning");
    expect(getTabletDashboardSelectionReset()).toEqual({
      selectedSessionId: null,
      selectedWorkItemId: null,
    });
  });
});
