import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock db: control the two lookups pushToUser makes (preference + tokens).
const prefFindFirst = vi.fn();
const tokensFindMany = vi.fn();
const deleteWhere = vi.fn((..._a: unknown[]) => Promise.resolve());

vi.mock("@bob/db/client", () => ({
  db: {
    query: {
      userPreferences: { findFirst: (...a: any[]) => prefFindFirst(...a) },
      devicePushTokens: { findMany: (...a: any[]) => tokensFindMany(...a) },
    },
    delete: vi.fn(() => ({ where: (...a: any[]) => deleteWhere(...a) })),
  },
}));

import { pushToUser } from "./push.js";

describe("pushToUser", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prefFindFirst.mockResolvedValue({ pushNotifications: true });
    tokensFindMany.mockResolvedValue([{ expoPushToken: "ExponentPushToken[aaa]" }]);
    (globalThis.fetch as any) = vi.fn(async () => ({
      ok: true,
      json: async () => ({ data: [{ status: "ok" }] }),
    }));
  });

  it("sends an Expo message to each enabled token", async () => {
    await pushToUser("user-1", { title: "Done", body: "Task finished" });

    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    const [url, init] = (globalThis.fetch as any).mock.calls[0];
    expect(url).toContain("exp.host");
    const body = JSON.parse(init.body);
    expect(body).toHaveLength(1);
    expect(body[0].to).toBe("ExponentPushToken[aaa]");
    expect(body[0].title).toBe("Done");
  });

  it("does not send when the user disabled push in settings", async () => {
    prefFindFirst.mockResolvedValue({ pushNotifications: false });

    await pushToUser("user-1", { title: "Done", body: "x" });

    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("sends when no preference row exists (defaults to enabled)", async () => {
    prefFindFirst.mockResolvedValue(undefined);

    await pushToUser("user-1", { title: "Done", body: "x" });

    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it("prunes tokens Expo reports as DeviceNotRegistered", async () => {
    tokensFindMany.mockResolvedValue([
      { expoPushToken: "ExponentPushToken[dead]" },
    ]);
    (globalThis.fetch as any) = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        data: [{ status: "error", details: { error: "DeviceNotRegistered" } }],
      }),
    }));

    await pushToUser("user-1", { title: "x", body: "y" });

    expect(deleteWhere).toHaveBeenCalledTimes(1);
  });

  it("never throws when the Expo API fails", async () => {
    (globalThis.fetch as any) = vi.fn(async () => ({
      ok: false,
      status: 500,
      text: async () => "boom",
    }));

    await expect(
      pushToUser("user-1", { title: "x", body: "y" }),
    ).resolves.toBeUndefined();
  });
});
