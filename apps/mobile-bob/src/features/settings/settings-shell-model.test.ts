/**
 * One settings definition, two shells.
 *
 * Phone and tablet are different jobs: the phone is for review on the road —
 * one thing at a time, pushed and popped — while the tablet is for working
 * sessions, where a person wants the list and the detail on screen together
 * and expects to move between sections without losing their place.
 *
 * The SECTIONS are identical, though, and duplicating them is how the two
 * drift until a setting exists on one device and not the other. So the
 * registry is shared and each shell only decides presentation.
 */
import { describe, expect, it } from "vitest";

import {
  SETTINGS_SECTIONS,
  resolveSettingsShell,
  sectionForRoute,
} from "./settings-shell-model";

describe("SETTINGS_SECTIONS", () => {
  it("is the single definition both shells render", () => {
    expect(SETTINGS_SECTIONS.map((s) => s.key)).toEqual([
      "account",
      "workspace",
      "notifications",
      "providers",
      "apiKeys",
      "appearance",
      "device",
    ]);
  });

  it("gives every section a route, so a phone push and a tablet deep link agree", () => {
    for (const section of SETTINGS_SECTIONS) {
      expect(section.route).toBe(`/settings/${section.slug}`);
    }
  });
});

describe("resolveSettingsShell", () => {
  it("uses push navigation on a phone, where one thing at a time is the point", () => {
    const shell = resolveSettingsShell({ isTablet: false, width: 390 });

    expect(shell.mode).toBe("stack");
    expect(shell.showsDetailAlongsideList).toBe(false);
  });

  it("uses master-detail on a tablet, so a working session keeps both in view", () => {
    const shell = resolveSettingsShell({ isTablet: true, width: 1024 });

    expect(shell.mode).toBe("split");
    expect(shell.showsDetailAlongsideList).toBe(true);
  });

  it("falls back to a stack on a narrow tablet window", () => {
    // Split View and Slide Over give an iPad a phone-width window; a
    // master-detail layout there leaves two unusable columns.
    const shell = resolveSettingsShell({ isTablet: true, width: 500 });

    expect(shell.mode).toBe("stack");
  });

  it("selects a default section for the tablet detail pane", () => {
    // A split layout with an empty right half looks broken on open.
    expect(resolveSettingsShell({ isTablet: true, width: 1024 }).initialSection).toBe("account");
    // The phone opens on the list itself, so it selects nothing.
    expect(resolveSettingsShell({ isTablet: false, width: 390 }).initialSection).toBeNull();
  });
});

describe("sectionForRoute", () => {
  it("maps a route back to its section, so a deep link selects the right pane", () => {
    expect(sectionForRoute("/settings/notifications")?.key).toBe("notifications");
  });

  it("tolerates a trailing slash and a query string", () => {
    expect(sectionForRoute("/settings/notifications/")?.key).toBe("notifications");
    expect(sectionForRoute("/settings/notifications?from=push")?.key).toBe("notifications");
  });

  it("returns null for an unknown route rather than guessing a section", () => {
    expect(sectionForRoute("/settings/nonsense")).toBeNull();
    expect(sectionForRoute("/tasks")).toBeNull();
  });
});
