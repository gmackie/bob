/**
 * Reading and writing per-type notification preferences.
 *
 * The rows are sparse — one exists only where a person expressed an opinion —
 * so writing has to upsert on (user, type, channel) rather than insert, and
 * reading has to return the raw rows for the shared resolver to merge with
 * defaults. Resolving defaults server-side would freeze them into every
 * response and make changing them a migration.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@bob/db/client", () => ({ db: {} }));

import { notificationPreferencesSetInput } from "../notificationPreferences.js";

describe("notificationPreferencesSetInput", () => {
  it("accepts a known type and channel", () => {
    expect(() =>
      notificationPreferencesSetInput.parse({
        type: "work_item_needs_input",
        channel: "push",
        enabled: false,
      }),
    ).not.toThrow();
  });

  it("rejects a channel the resolver does not understand", () => {
    // The DB column is free-form text; validating here is what stops a row
    // being written that nothing will ever read.
    expect(() =>
      notificationPreferencesSetInput.parse({
        type: "work_item_needs_input",
        channel: "carrier_pigeon",
        enabled: true,
      }),
    ).toThrow();
  });

  it("rejects an unknown notification type", () => {
    expect(() =>
      notificationPreferencesSetInput.parse({
        type: "not_a_real_event",
        channel: "push",
        enabled: true,
      }),
    ).toThrow();
  });

  it("requires an explicit enabled value", () => {
    // Defaulting here would silently write an opinion the person never gave.
    expect(() =>
      notificationPreferencesSetInput.parse({
        type: "work_item_needs_input",
        channel: "push",
      }),
    ).toThrow();
  });
});
