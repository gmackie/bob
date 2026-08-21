import { describe, expect, it, vi } from "vitest";

import {
  createHermesClient,
  deriveHermesHealth,
  findLastBriefing,
} from "./hermes-client";

describe("Hermes console client", () => {
  it("loads the aggregated overview through Bob", async () => {
    const fetcher = vi.fn<typeof fetch>(async () =>
      Response.json({
        status: {},
        platforms: [],
        jobs: [],
        sessions: [],
        sessionTotal: 0,
        providers: [],
      }),
    );
    const client = createHermesClient({ fetcher });
    await client.getOverview();
    expect(fetcher).toHaveBeenCalledWith(
      "/api/hermes/overview",
      expect.objectContaining({ credentials: "include" }),
    );
  });

  it("rejects a malformed Telegram token before sending it", async () => {
    const fetcher = vi.fn<typeof fetch>();
    const client = createHermesClient({ fetcher });
    await expect(
      client.updateMessagingPlatform("telegram", {
        enabled: true,
        env: { TELEGRAM_BOT_TOKEN: "bad" },
      }),
    ).rejects.toThrow(/numeric bot ID/);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("rejects malformed connector payload shapes", async () => {
    const client = createHermesClient({ fetcher: vi.fn<typeof fetch>() });
    await expect(
      client.updateMessagingPlatform(
        "telegram",
        null as unknown as Parameters<typeof client.updateMessagingPlatform>[1],
      ),
    ).rejects.toThrow(/object/);
    await expect(
      client.updateMessagingPlatform("telegram", {
        env: { TELEGRAM_ALLOWED_USERS: 42 as unknown as string },
      }),
    ).rejects.toThrow(/string values/);
    await expect(
      client.updateMessagingPlatform("telegram", {
        enabled: "yes" as unknown as boolean,
      }),
    ).rejects.toThrow(/boolean/);
    await expect(
      client.updateMessagingPlatform("telegram", {
        clear_env: [""] as string[],
      }),
    ).rejects.toThrow(/non-empty strings/);
  });

  it("sends validated connector updates through the native Bob API", async () => {
    const fetcher = vi.fn<typeof fetch>(async () =>
      Response.json({ ok: true, platform: "telegram" }),
    );
    const client = createHermesClient({ fetcher });

    await expect(
      client.updateMessagingPlatform("telegram", {
        enabled: true,
        env: { TELEGRAM_ALLOWED_USERS: "123" },
      }),
    ).resolves.toEqual({ ok: true, platform: "telegram" });
    expect(fetcher).toHaveBeenCalledWith(
      "/api/hermes/messaging/platforms/telegram",
      expect.objectContaining({
        method: "PUT",
        body: JSON.stringify({
          enabled: true,
          env: { TELEGRAM_ALLOWED_USERS: "123" },
        }),
      }),
    );
  });

  it("derives health and selects the newest morning briefing", () => {
    expect(
      deriveHermesHealth({
        status: { gateway_running: false, gateway_state: "stopped" },
        providers: [],
      }),
    ).toEqual(expect.objectContaining({ label: "Needs attention" }));
    expect(
      findLastBriefing([
        {
          id: "old",
          name: "Morning briefing",
          enabled: true,
          last_run_at: "2026-08-20T10:00:00Z",
        },
        {
          id: "new",
          name: "Morning briefing",
          enabled: true,
          last_run_at: "2026-08-21T10:00:00Z",
        },
      ])?.id,
    ).toBe("new");
  });
});
