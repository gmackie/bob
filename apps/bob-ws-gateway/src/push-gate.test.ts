/**
 * Per-type gating at the point pushes are actually sent.
 *
 * `pushEnabledForUser` consulted one boolean — `userPreferences.pushNotifications`
 * — so a person's only options were every event or none. Bob emits six quite
 * different events, and the one worth a buzz (an agent blocked, waiting on
 * you) arrived alongside "batch completed".
 *
 * The decision itself lives in @bob/notifications/preferences so the gateway
 * and the API cannot drift apart about the same user. This covers the wiring:
 * that the gateway asks the right question, and that pushes carrying no type
 * (terminal session events, which are not work-item notifications) still fall
 * back to the master switch rather than being silently dropped.
 */
import { describe, expect, it } from "vitest";

import { shouldSendPush } from "./push-gate.js";

const masters = { push: true, email: true };

describe("shouldSendPush", () => {
  it("sends a blocked-agent push by default", () => {
    expect(
      shouldSendPush({ type: "work_item_needs_input", masters, overrides: {}, quietHours: null }),
    ).toBe(true);
  });

  it("withholds a routine completion by default", () => {
    expect(
      shouldSendPush({ type: "task_completed", masters, overrides: {}, quietHours: null }),
    ).toBe(false);
  });

  it("honours an explicit opt-in for a type that is off by default", () => {
    expect(
      shouldSendPush({
        type: "task_completed",
        masters,
        overrides: { task_completed: { push: true } },
        quietHours: null,
      }),
    ).toBe(true);
  });

  it("falls back to the master switch for a push with no type", () => {
    // Terminal session pushes are not work-item notifications. Dropping them
    // for having no type would silently remove a feature that works today.
    expect(shouldSendPush({ type: undefined, masters, overrides: {}, quietHours: null })).toBe(true);
    expect(
      shouldSendPush({
        type: undefined,
        masters: { push: false, email: true },
        overrides: {},
        quietHours: null,
      }),
    ).toBe(false);
  });

  it("respects the master switch as a veto over a per-type opt-in", () => {
    expect(
      shouldSendPush({
        type: "work_item_needs_input",
        masters: { push: false, email: true },
        overrides: { work_item_needs_input: { push: true } },
        quietHours: null,
      }),
    ).toBe(false);
  });

  it("suppresses inside quiet hours", () => {
    expect(
      shouldSendPush({
        type: "work_item_needs_input",
        masters,
        overrides: {},
        quietHours: { start: "22:00", end: "08:00" },
        now: new Date("2026-09-03T23:30:00Z"),
      }),
    ).toBe(false);
  });

  it("applies quiet hours to an untyped push too", () => {
    // A terminal push at 3am is exactly as unwelcome as any other.
    expect(
      shouldSendPush({
        type: undefined,
        masters,
        overrides: {},
        quietHours: { start: "22:00", end: "08:00" },
        now: new Date("2026-09-03T03:00:00Z"),
      }),
    ).toBe(false);
  });
});
