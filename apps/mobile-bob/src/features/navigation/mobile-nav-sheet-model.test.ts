import { describe, expect, it } from "vitest";

import { markActiveDestination } from "./mobile-nav";
import { MOBILE_TABS, MORE_DESTINATIONS } from "./mobile-tabs";

/**
 * The sheet behind "More" is the tab bar's overflow. It rendered every
 * destination, so Home, Chat, Tasks and Nodes appeared twice on screen — once
 * as a tab and again in the sheet — which read as a second, fuller navigation
 * rather than the remainder. This pins the split the sheet now applies.
 */
describe("More sheet destinations", () => {
  // Widened to string: "/more" is a tab pseudo-route, not a real Href.
  const sheetHrefs = new Set<string>(MORE_DESTINATIONS.map((d) => d.href));

  it("omits every destination the tab bar already shows", () => {
    for (const tab of MOBILE_TABS) {
      expect(sheetHrefs.has(tab.href)).toBe(false);
    }
  });

  it("keeps everything that has no tab of its own", () => {
    expect([...sheetHrefs]).toEqual([
      "/planning",
      "/pull-requests",
      "/notifications",
      "/settings",
    ]);
  });

  it("still marks the active row when the route lives behind More", () => {
    const active = markActiveDestination("/settings/notifications").filter((d) =>
      sheetHrefs.has(d.href),
    );
    expect(active.find((d) => d.isActive)?.href).toBe("/settings");
  });
});
