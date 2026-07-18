import { describe, expect, it, vi } from "vitest";

import { HermesApiError, createHermesClient } from "./client.js";
import { deriveHermesHealth, findLastBriefing } from "./console-model.js";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("createHermesClient", () => {
  it("loads the native-console overview in parallel from the prefixed proxy", async () => {
    const fetcher = vi.fn<typeof fetch>((input) => {
      const path = String(input);
      if (path.endsWith("/status")) return Promise.resolve(jsonResponse({ gateway_running: true }));
      if (path.includes("/messaging/platforms")) return Promise.resolve(jsonResponse({ platforms: [] }));
      if (path.includes("/cron/jobs")) return Promise.resolve(jsonResponse([]));
      if (path.includes("/sessions")) return Promise.resolve(jsonResponse({ sessions: [], total: 0, limit: 12, offset: 0 }));
      if (path.includes("/providers/oauth")) return Promise.resolve(jsonResponse({ providers: [] }));
      throw new Error(`Unexpected path: ${path}`);
    });

    const client = createHermesClient({ fetcher });
    await expect(client.getOverview()).resolves.toMatchObject({
      status: { gateway_running: true },
      platforms: [],
      jobs: [],
      sessions: [],
      providers: [],
    });

    expect(fetcher).toHaveBeenCalledTimes(5);
    expect(fetcher.mock.calls.map(([input]) => String(input))).toEqual([
      "/api/hermes/status",
      "/api/hermes/messaging/platforms",
      "/api/hermes/cron/jobs?profile=all",
      "/api/hermes/sessions?limit=12&offset=0&order=recent",
      "/api/hermes/providers/oauth",
    ]);
    for (const [, init] of fetcher.mock.calls) {
      expect(init?.credentials).toBe("include");
    }
  });

  it("encodes job and profile identifiers for automation actions", async () => {
    const fetcher = vi.fn<typeof fetch>(() => Promise.resolve(jsonResponse({ id: "morning briefing", enabled: false })));
    const client = createHermesClient({ fetcher });

    await client.pauseCronJob("morning briefing", "default profile");

    expect(fetcher).toHaveBeenCalledWith(
      "/api/hermes/cron/jobs/morning%20briefing/pause?profile=default%20profile",
      expect.objectContaining({ method: "POST", credentials: "include" }),
    );
  });

  it("sends connector updates only to Hermes and never returns submitted secrets", async () => {
    const fetcher = vi.fn<typeof fetch>(() => Promise.resolve(jsonResponse({ ok: true, platform: "telegram" })));
    const client = createHermesClient({ fetcher });

    await expect(client.updateMessagingPlatform("telegram", {
      enabled: true,
      env: { TELEGRAM_BOT_TOKEN: "secret-token" },
    })).resolves.toEqual({ ok: true, platform: "telegram" });

    const [, init] = fetcher.mock.calls[0]!;
    expect(JSON.parse(String(init?.body))).toEqual({
      enabled: true,
      env: { TELEGRAM_BOT_TOKEN: "secret-token" },
    });
  });

  it("surfaces structured HTTP failures without leaking response HTML", async () => {
    const fetcher = vi.fn<typeof fetch>(() => Promise.resolve(jsonResponse({ detail: "Gateway unavailable" }, 502)));
    const client = createHermesClient({ fetcher });

    await expect(client.getStatus()).rejects.toEqual(
      expect.objectContaining<HermesApiError>({
        name: "HermesApiError",
        status: 502,
        message: "Gateway unavailable",
      }),
    );
  });
});

describe("Hermes console model", () => {
  it("turns gateway and missing provider authentication red for the operator", () => {
    expect(deriveHermesHealth({
      status: { gateway_running: false, gateway_state: "stopped" },
      providers: [{ status: { logged_in: false } }, { status: { logged_in: false, error: "expired" } }],
    })).toEqual({ tone: "danger", label: "Needs attention", issues: ["Gateway is stopped", "No provider authentication is active"] });
  });

  it("finds the latest morning briefing run", () => {
    expect(findLastBriefing([
      { id: "other", enabled: true, name: "Nightly vault wrap-up", last_run_at: "2026-07-18T05:00:00Z" },
      { id: "briefing", enabled: true, name: "Morning briefing", last_run_at: "2026-07-18T14:00:00Z", last_status: "success" },
    ])).toMatchObject({ id: "briefing", last_status: "success" });
  });
});
