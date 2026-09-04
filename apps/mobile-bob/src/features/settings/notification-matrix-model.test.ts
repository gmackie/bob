/**
 * The presentation model for the notification matrix.
 *
 * Kept separate from the screen so the rules are testable without a React
 * Native runtime — the interesting behaviour is which switch reads as on,
 * what a person's current settings summarise to, and when a control should be
 * disabled because a master switch has vetoed the whole channel.
 */
import { describe, expect, it } from "vitest";

import {
  buildNotificationMatrix,
  summariseNotificationPreferences,
} from "./notification-matrix-model";

const allOn = { push: true, email: true };

describe("buildNotificationMatrix", () => {
  it("renders every type in a stable, meaningful order", () => {
    // Blocking events first: the two a person must act on lead the screen
    // rather than being buried under routine chatter.
    const rows = buildNotificationMatrix({ masters: allOn, overrides: {} });

    expect(rows.map((r) => r.type)).toEqual([
      "work_item_needs_input",
      "work_item_review_ready",
      "work_item_assigned",
      "work_item_commented",
      "task_completed",
      "batch_completed",
    ]);
  });

  it("gives every row a human label rather than the enum value", () => {
    const rows = buildNotificationMatrix({ masters: allOn, overrides: {} });

    expect(rows[0]?.label).toBe("Needs input");
    expect(rows.every((r) => !r.label.includes("_"))).toBe(true);
  });

  it("shows defaults when a person has expressed no opinion", () => {
    const rows = buildNotificationMatrix({ masters: allOn, overrides: {} });
    const needsInput = rows.find((r) => r.type === "work_item_needs_input")!;
    const completed = rows.find((r) => r.type === "task_completed")!;

    expect(needsInput.channels.push.enabled).toBe(true);
    expect(completed.channels.push.enabled).toBe(false);
    // In-app is on for everything: it is the record, not an interruption.
    expect(rows.every((r) => r.channels.in_app.enabled)).toBe(true);
  });

  it("shows an override over the default", () => {
    const rows = buildNotificationMatrix({
      masters: allOn,
      overrides: { task_completed: { push: true } },
    });

    expect(rows.find((r) => r.type === "task_completed")!.channels.push.enabled).toBe(true);
  });

  it("disables a channel's switches when its master is off, without losing the stored value", () => {
    // The master switch is a veto, so the row must LOOK inert — but the
    // person's per-type choice is still theirs, and comes back when they
    // re-enable the channel.
    const rows = buildNotificationMatrix({
      masters: { push: false, email: true },
      overrides: { work_item_needs_input: { push: true } },
    });
    const row = rows.find((r) => r.type === "work_item_needs_input")!;

    expect(row.channels.push.disabled).toBe(true);
    expect(row.channels.push.enabled).toBe(true);
    expect(row.channels.email.disabled).toBe(false);
  });

  it("never disables in-app, which no master switch governs", () => {
    const rows = buildNotificationMatrix({
      masters: { push: false, email: false },
      overrides: {},
    });

    expect(rows.every((r) => !r.channels.in_app.disabled)).toBe(true);
  });
});

describe("summariseNotificationPreferences", () => {
  it("summarises the default posture in the operator's terms", () => {
    // This string is the settings-index subtitle; it has to be true at a
    // glance, not a count of switches.
    expect(summariseNotificationPreferences({ masters: allOn, overrides: {} })).toBe(
      "Blocking events only",
    );
  });

  it("says everything when every type pushes", () => {
    expect(
      summariseNotificationPreferences({
        masters: allOn,
        overrides: {
          work_item_assigned: { push: true },
          work_item_commented: { push: true },
          task_completed: { push: true },
          batch_completed: { push: true },
        },
      }),
    ).toBe("All events");
  });

  it("says push is off when the master switch is off, whatever the rows say", () => {
    expect(
      summariseNotificationPreferences({
        masters: { push: false, email: false },
        overrides: { work_item_needs_input: { push: true } },
      }),
    ).toBe("Push off");
  });

  it("counts a custom selection rather than mislabelling it", () => {
    expect(
      summariseNotificationPreferences({
        masters: allOn,
        overrides: { work_item_needs_input: { push: false } },
      }),
    ).toBe("1 event");
  });
});
