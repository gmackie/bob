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

  it("throws on Expo API failure so the outbox can retry", async () => {
    // Contract change with the outbox: pushToUser signals retryable failures
    // upward instead of swallowing them — the outbox worker owns retries and
    // the never-crash guarantee.
    (globalThis.fetch as any) = vi.fn(async () => ({
      ok: false,
      status: 500,
      text: async () => "boom",
    }));

    await expect(pushToUser("user-1", { title: "x", body: "y" })).rejects.toThrow(
      "Expo API 500",
    );
  });

  it("returns ticket ids keyed by token for the receipts cron", async () => {
    (globalThis.fetch as any) = vi.fn(async () => ({
      ok: true,
      json: async () => ({ data: [{ status: "ok", id: "ticket-1" }] }),
    }));

    const result = await pushToUser("user-1", { title: "x", body: "y" });
    expect(result.delivered).toBe(true);
    expect(result.tickets).toEqual({ "ExponentPushToken[aaa]": "ticket-1" });
  });

  it("returns undelivered without calling Expo when the user has zero tokens", async () => {
    tokensFindMany.mockResolvedValue([]);

    const result = await pushToUser("user-1", { title: "x", body: "y" });

    // No tokens: undelivered and NOT retryable (retrying won't create a token).
    expect(result).toEqual({ delivered: false, tickets: {}, retryable: false });
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("rethrows token-lookup failures so the outbox can retry", async () => {
    tokensFindMany.mockRejectedValue(new Error("db down"));

    await expect(
      pushToUser("user-1", { title: "x", body: "y" }),
    ).rejects.toThrow("db down");
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});
