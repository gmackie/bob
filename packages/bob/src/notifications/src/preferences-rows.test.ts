/**
 * Turning stored rows into the shape the resolver takes.
 *
 * The rows are sparse — one exists only where a person expressed an opinion —
 * and the column is free-form text, so a row can name a channel or type this
 * build does not know. Ignoring those rather than trusting them keeps a stale
 * or hand-edited row from silently changing what a person receives.
 */
import { describe, expect, it } from "vitest";

import { overridesFromRows, quietHoursFromPreferences } from "./preferences-rows.js";

describe("overridesFromRows", () => {
  it("groups rows by type and channel", () => {
    expect(
      overridesFromRows([
        { type: "task_completed", channel: "push", enabled: true },
        { type: "task_completed", channel: "email", enabled: false },
        { type: "work_item_commented", channel: "push", enabled: false },
      ]),
    ).toEqual({
      task_completed: { push: true, email: false },
      work_item_commented: { push: false },
    });
  });

  it("returns an empty map for no rows, so defaults apply", () => {
    expect(overridesFromRows([])).toEqual({});
  });

  it("ignores a channel this build does not know", () => {
    // The column is text; a future or hand-written channel must not be coerced
    // into one we do understand.
    expect(
      overridesFromRows([{ type: "task_completed", channel: "carrier_pigeon", enabled: true }]),
    ).toEqual({});
  });

  it("ignores an unknown notification type", () => {
    expect(
      overridesFromRows([{ type: "some_removed_type", channel: "push", enabled: true }]),
    ).toEqual({});
  });
});

describe("quietHoursFromPreferences", () => {
  it("reads a complete window", () => {
    expect(
      quietHoursFromPreferences({ quietHoursStart: "22:00", quietHoursEnd: "08:00" }),
    ).toEqual({ start: "22:00", end: "08:00" });
  });

  it("treats a half-set window as no window", () => {
    // One end without the other cannot describe a range; guessing the other
    // end would silence notifications a person never asked to silence.
    expect(quietHoursFromPreferences({ quietHoursStart: "22:00", quietHoursEnd: null })).toBeNull();
    expect(quietHoursFromPreferences({ quietHoursStart: null, quietHoursEnd: "08:00" })).toBeNull();
    expect(quietHoursFromPreferences(null)).toBeNull();
  });
});
