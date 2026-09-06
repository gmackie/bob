import { describe, expect, it } from "vitest";

import {
  MOBILE_NAV_DESTINATIONS,
  SPLIT_MIN_WIDTH,
  markActiveDestination,
  resolveHeaderLeadingAction,
  shouldUseSplitPaneLayout,
} from "./mobile-nav";

describe("resolveHeaderLeadingAction", () => {
  it("offers the menu on the home screen, where Back would be a dead no-op", () => {
    // /chat is the authenticated home. router.back() there does nothing at all,
    // which is what left the phone with no way to reach any other screen.
    expect(resolveHeaderLeadingAction({ canGoBack: false })).toBe("menu");
  });

  it("keeps Back when there is history to pop", () => {
    expect(resolveHeaderLeadingAction({ canGoBack: true })).toBe("back");
  });
});

describe("MOBILE_NAV_DESTINATIONS", () => {
  it("reaches every phone surface that was previously tablet-only", () => {
    const hrefs = MOBILE_NAV_DESTINATIONS.map((d) => d.href);
    for (const href of [
      "/home",
      "/chat",
      "/tasks",
      "/planning",
      "/pull-requests",
      "/nodes",
      "/notifications",
      "/settings",
    ]) {
      expect(hrefs).toContain(href);
    }
  });

  it("uses absolute hrefs and unique labels", () => {
    const labels = new Set(MOBILE_NAV_DESTINATIONS.map((d) => d.label));
    expect(labels.size).toBe(MOBILE_NAV_DESTINATIONS.length);
    for (const d of MOBILE_NAV_DESTINATIONS) expect(d.href.startsWith("/")).toBe(true);
  });
});

describe("markActiveDestination", () => {
  it("marks the exact route active", () => {
    const active = markActiveDestination("/tasks").filter((d) => d.isActive);
    expect(active.map((d) => d.href)).toEqual(["/tasks"]);
  });

  it("marks a parent active for nested routes", () => {
    // /settings/notifications should still light up Settings.
    const active = markActiveDestination("/settings/notifications").filter((d) => d.isActive);
    expect(active.map((d) => d.href)).toEqual(["/settings"]);
  });

  it("marks nothing active on an unknown route", () => {
    expect(markActiveDestination("/nope").some((d) => d.isActive)).toBe(false);
  });
});

describe("shouldUseSplitPaneLayout", () => {
  it("uses the split pane on a landscape tablet", () => {
    expect(shouldUseSplitPaneLayout({ isTablet: true, width: 1180 })).toBe(true);
  });

  it("falls back to the clean mobile view on a portrait tablet", () => {
    // An iPad in portrait is 820pt... but Split View and Slide Over hand the
    // app a phone-width window, which is what this guards.
    expect(shouldUseSplitPaneLayout({ isTablet: true, width: 507 })).toBe(false);
  });

  it("never splits on a phone, however wide the window reports", () => {
    expect(shouldUseSplitPaneLayout({ isTablet: false, width: 1180 })).toBe(false);
  });

  it("treats the threshold as inclusive", () => {
    expect(shouldUseSplitPaneLayout({ isTablet: true, width: SPLIT_MIN_WIDTH })).toBe(true);
    expect(shouldUseSplitPaneLayout({ isTablet: true, width: SPLIT_MIN_WIDTH - 1 })).toBe(false);
  });
});
