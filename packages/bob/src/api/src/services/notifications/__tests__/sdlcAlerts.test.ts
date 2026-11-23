import { beforeEach, describe, expect, it, vi } from "vitest";

const createInAppNotification = vi.fn();
vi.mock("../notificationService.js", () => ({
  createInAppNotification: (...args: unknown[]) => createInAppNotification(...args) as unknown,
}));

import type { SdlcAlertDelivery } from "../sdlcAlerts.js";
import { sendSdlcAlerts } from "../sdlcAlerts.js";

const prefs = new Map<string, { pushNotifications: boolean; emailNotifications: boolean; quietHoursStart: string | null; quietHoursEnd: string | null }>();
const rows = new Map<string, { type: string; channel: string; enabled: boolean }[]>();
// The where clause is opaque here; each test serves one user per lookup in call order.
let lookups: string[] = [];
const db = {
  query: {
    userPreferences: { findFirst: vi.fn(() => Promise.resolve(prefs.get(lookups[0] ?? ""))) },
    notificationPreferences: { findMany: vi.fn(() => Promise.resolve(rows.get(lookups.shift() ?? "") ?? [])) },
  },
} as never;

const delivery = (userId: string, over: Partial<SdlcAlertDelivery> = {}): SdlcAlertDelivery =>
  ({ userId, type: "sdlc_waiting_input", title: "BOB-71 needs your answer", body: "gmackie/bob · plan p: Ship it?", pushBody: "gmackie/bob · open Bob to answer", itemId: "71", url: "/sdlc?item=71", ...over });

describe("sendSdlcAlerts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prefs.clear(); rows.clear(); lookups = [];
    createInAppNotification.mockResolvedValue({ id: "n1" });
  });

  it("writes an inbox row and pushes with the SDLC routing data by default", async () => {
    lookups = ["u1"];
    expect(await sendSdlcAlerts(db, [delivery("u1")])).toBe(1);
    expect(createInAppNotification).toHaveBeenCalledWith(db, {
      userId: "u1", type: "sdlc_waiting_input", title: "BOB-71 needs your answer", body: "gmackie/bob · plan p: Ship it?",
      pushBody: "gmackie/bob · open Bob to answer", url: "/sdlc?item=71", push: true, pushData: { type: "sdlc", itemId: "71" },
    });
  });

  it("applies the person's per-type push preference and the master switch", async () => {
    rows.set("u1", [{ type: "sdlc_review", channel: "push", enabled: false }]);
    prefs.set("u2", { pushNotifications: false, emailNotifications: false, quietHoursStart: null, quietHoursEnd: null });
    lookups = ["u1", "u2"];
    await sendSdlcAlerts(db, [delivery("u1", { type: "sdlc_review" }), delivery("u2")]);
    expect(createInAppNotification.mock.calls.map(([, input]) => [(input as { userId: string }).userId, (input as { push: boolean }).push])).toEqual([["u1", false], ["u2", false]]);
  });

  it("skips a type the person turned off everywhere, and a summary carries no item id", async () => {
    rows.set("u1", [{ type: "sdlc_failed", channel: "push", enabled: false }, { type: "sdlc_failed", channel: "in_app", enabled: false }]);
    lookups = ["u1"];
    await sendSdlcAlerts(db, [delivery("u1", { type: "sdlc_failed" }), delivery("u1", { itemId: null, url: "/sdlc", title: "3 more" })]);
    expect(createInAppNotification).toHaveBeenCalledTimes(1);
    expect(createInAppNotification.mock.calls[0]?.[1]).toMatchObject({ title: "3 more", pushData: { type: "sdlc" } });
  });

  it("keeps going when one delivery fails", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    createInAppNotification.mockRejectedValueOnce(new Error("db down"));
    lookups = ["u1"];
    expect(await sendSdlcAlerts(db, [delivery("u1"), delivery("u1", { itemId: "72" })])).toBe(1);
    warn.mockRestore();
  });
});
