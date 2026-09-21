import { describe, expect, it } from "vitest";

import { MOBILE_NAV_DESTINATIONS } from "./mobile-nav";
import {
  MOBILE_TABS,
  MORE_DESTINATIONS,
  resolveTabForPath,
  shouldNavigateToTab,
  tabHref,
} from "./mobile-tabs";

// The phone had a menu sheet as its only navigation. A tab bar is the iOS
// pattern for "four or five places I go constantly"; everything else lives
// behind More. The model decides which is which so the layout cannot drift
// from the sheet.

describe("MOBILE_TABS", () => {
  it("has the five places a person on the road goes constantly, Home first", () => {
    expect(MOBILE_TABS.map((t) => t.key)).toEqual(["home", "tasks", "chat", "nodes", "more"]);
    expect(MOBILE_TABS[0]).toMatchObject({ key: "home", href: "/home", label: "Home" });
  });

  it("uses absolute hrefs and unique labels", () => {
    const labels = new Set(MOBILE_TABS.map((t) => t.label));
    expect(labels.size).toBe(MOBILE_TABS.length);
    for (const tab of MOBILE_TABS) expect(tab.href.startsWith("/")).toBe(true);
  });
});

describe("MORE_DESTINATIONS", () => {
  it("holds exactly the sheet destinations that are not tabs, in the sheet's order", () => {
    const tabHrefs = new Set(MOBILE_TABS.map((t) => t.href));
    expect(MORE_DESTINATIONS.map((d) => d.href)).toEqual(
      MOBILE_NAV_DESTINATIONS.map((d) => d.href).filter((href) => !tabHrefs.has(href)),
    );
  });

  it("still reaches every destination the sheet did — nothing becomes unreachable", () => {
    const reachable = new Set([...MOBILE_TABS.map((t) => t.href), ...MORE_DESTINATIONS.map((d) => d.href)]);
    for (const destination of MOBILE_NAV_DESTINATIONS) {
      expect(reachable.has(destination.href)).toBe(true);
    }
  });
});

describe("resolveTabForPath", () => {
  it("lights the tab that owns the current route", () => {
    expect(resolveTabForPath("/home")).toBe("home");
    expect(resolveTabForPath("/tasks/queue")).toBe("tasks");
    expect(resolveTabForPath("/chat")).toBe("chat");
    expect(resolveTabForPath("/nodes")).toBe("nodes");
  });

  it("attributes detail routes to the tab they are reached from", () => {
    // A work item is opened from Tasks or Home; Tasks owns it.
    expect(resolveTabForPath("/work-items/wi_1")).toBe("tasks");
    expect(resolveTabForPath("/work-items/wi_1/workspace")).toBe("tasks");
    // Sessions and providers are reached from Nodes/Tasks; keep Tasks lit.
    expect(resolveTabForPath("/sessions/s_1")).toBe("tasks");
  });

  it("lights More for everything behind it", () => {
    expect(resolveTabForPath("/settings")).toBe("more");
    expect(resolveTabForPath("/settings/notifications")).toBe("more");
    expect(resolveTabForPath("/planning")).toBe("more");
    expect(resolveTabForPath("/planning/sessions/p_1")).toBe("more");
    expect(resolveTabForPath("/pull-requests")).toBe("more");
    expect(resolveTabForPath("/notifications")).toBe("more");
    expect(resolveTabForPath("/projects")).toBe("more");
  });

  it("falls back to Home for the entry route and anything unknown", () => {
    expect(resolveTabForPath("/")).toBe("home");
    expect(resolveTabForPath("/nope")).toBe("home");
  });
});

describe("tabHref", () => {
  it("returns the tab's own route", () => {
    expect(tabHref("nodes")).toBe("/nodes");
    expect(tabHref("more")).toBe("/more");
  });
});

describe("shouldNavigateToTab", () => {
  it("returns to the tab root from a screen that tab owns", () => {
    // Opening a work item from Home lights the Tasks tab. Tapping it used to
    // do nothing, so the detail screen had no exit but the back gesture.
    expect(
      shouldNavigateToTab({ tab: "tasks", href: "/tasks", pathname: "/work-items/abc" }),
    ).toBe(true);
    expect(
      shouldNavigateToTab({ tab: "tasks", href: "/tasks", pathname: "/tasks/queue" }),
    ).toBe(true);
  });

  it("stays put when already standing on the tab root", () => {
    expect(
      shouldNavigateToTab({ tab: "tasks", href: "/tasks", pathname: "/tasks" }),
    ).toBe(false);
    expect(
      shouldNavigateToTab({ tab: "home", href: "/home", pathname: "/home?from=x" }),
    ).toBe(false);
  });

  it("never navigates for More, which opens the sheet instead", () => {
    expect(
      shouldNavigateToTab({ tab: "more", href: "/more", pathname: "/settings" }),
    ).toBe(false);
  });
});
