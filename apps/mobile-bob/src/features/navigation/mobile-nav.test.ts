import { describe, expect, it } from "vitest";

import {
  MOBILE_NAV_DESTINATIONS,
  markActiveDestination,
  resolveHeaderLeadingAction,
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
