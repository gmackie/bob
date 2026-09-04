/**
 * Which notifications actually reach a person, resolved in ONE place.
 *
 * Before this, delivery was two booleans — `pushNotifications` and
 * `emailNotifications` — so the only choices were "every event" or "silence".
 * Bob emits six quite different events, and the one that matters (an agent
 * blocked, waiting on you) arrived in the same undifferentiated stream as
 * "batch completed".
 *
 * This resolver is deliberately pure and shared: the ws-gateway sends pushes
 * and the API sends email, and a second copy of these rules would drift. That
 * exact split — one process deciding differently from another about the same
 * user — is what made agent health unreliable for a day.
 */
import { describe, expect, it } from "vitest";

import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  resolveNotificationDelivery,
} from "./preferences.js";

const noRows = {};

describe("resolveNotificationDelivery", () => {
  it("pushes a blocked agent by default, because that is the event a person must act on", () => {
    expect(
      resolveNotificationDelivery({
        type: "work_item_needs_input",
        channel: "push",
        masters: { push: true, email: true },
        overrides: noRows,
      }),
    ).toBe(true);
  });

  it("does not push routine completions by default", () => {
    // "task completed" in the same stream as "an agent needs you" is how a
    // person learns to ignore the stream.
    expect(
      resolveNotificationDelivery({
        type: "task_completed",
        channel: "push",
        masters: { push: true, email: true },
        overrides: noRows,
      }),
    ).toBe(false);
  });

  it("keeps every type in the in-app centre by default", () => {
    // In-app costs nothing and is the record of what happened.
    for (const type of Object.keys(DEFAULT_NOTIFICATION_PREFERENCES)) {
      expect(
        resolveNotificationDelivery({
          type: type as never,
          channel: "in_app",
          masters: { push: true, email: true },
          overrides: noRows,
        }),
      ).toBe(true);
    }
  });

  it("lets an explicit override beat the default in both directions", () => {
    const on = resolveNotificationDelivery({
      type: "task_completed",
      channel: "push",
      masters: { push: true, email: true },
      overrides: { task_completed: { push: true } },
    });
    const off = resolveNotificationDelivery({
      type: "work_item_needs_input",
      channel: "push",
      masters: { push: true, email: true },
      overrides: { work_item_needs_input: { push: false } },
    });

    expect(on).toBe(true);
    expect(off).toBe(false);
  });

  it("treats the channel master switch as an absolute veto", () => {
    // Turning push off in settings must silence push, whatever the per-type
    // rows say — otherwise the master switch is a lie.
    expect(
      resolveNotificationDelivery({
        type: "work_item_needs_input",
        channel: "push",
        masters: { push: false, email: true },
        overrides: { work_item_needs_input: { push: true } },
      }),
    ).toBe(false);
  });

  it("does not let the push master switch silence in-app", () => {
    // In-app is not a push; muting your phone must not erase the record.
    expect(
      resolveNotificationDelivery({
        type: "work_item_needs_input",
        channel: "in_app",
        masters: { push: false, email: false },
        overrides: noRows,
      }),
    ).toBe(true);
  });
});

describe("quiet hours", () => {
  const base = {
    type: "work_item_needs_input",
    channel: "push",
    masters: { push: true, email: true },
    overrides: noRows,
  } as const;

  it("suppresses push inside a window that crosses midnight", () => {
    expect(
      resolveNotificationDelivery({
        ...base,
        quietHours: { start: "22:00", end: "08:00" },
        now: new Date("2026-09-03T23:30:00Z"),
      }),
    ).toBe(false);
    expect(
      resolveNotificationDelivery({
        ...base,
        quietHours: { start: "22:00", end: "08:00" },
        now: new Date("2026-09-03T03:00:00Z"),
      }),
    ).toBe(false);
  });

  it("allows push outside the window", () => {
    expect(
      resolveNotificationDelivery({
        ...base,
        quietHours: { start: "22:00", end: "08:00" },
        now: new Date("2026-09-03T12:00:00Z"),
      }),
    ).toBe(true);
  });

  it("never lets quiet hours suppress the in-app record", () => {
    // Quiet hours are about not being disturbed, not about losing history.
    expect(
      resolveNotificationDelivery({
        ...base,
        channel: "in_app",
        quietHours: { start: "22:00", end: "08:00" },
        now: new Date("2026-09-03T23:30:00Z"),
      }),
    ).toBe(true);
  });

  it("handles a window that does not cross midnight", () => {
    expect(
      resolveNotificationDelivery({
        ...base,
        quietHours: { start: "09:00", end: "17:00" },
        now: new Date("2026-09-03T12:00:00Z"),
      }),
    ).toBe(false);
  });

  it("ignores a malformed window rather than silencing everything", () => {
    // Failing closed here would mute a person's notifications with no
    // indication why; an unreadable window is treated as no window.
    expect(
      resolveNotificationDelivery({
        ...base,
        quietHours: { start: "nonsense", end: "08:00" },
        now: new Date("2026-09-03T23:30:00Z"),
      }),
    ).toBe(true);
  });
});
