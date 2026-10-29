import { afterEach, describe, expect, it, vi } from "vitest";

import {
  getIntegrationStatuses,
  initializeIntegrationConfig,
} from "@bob/config/integrations";

import { GET } from "./route";

const { getSession } = vi.hoisted(() => ({ getSession: vi.fn() }));
vi.mock("~/auth/server", () => ({ auth: { api: { getSession } } }));

afterEach(() => {
  initializeIntegrationConfig({});
  vi.restoreAllMocks();
});

describe("runtime integration configuration API", () => {
  it("requires a session and never caches a response", async () => {
    getSession.mockResolvedValue(null);
    const response = await GET(
      new Request("https://bob.example/api/integrations/configuration"),
    );
    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.json()).toEqual({ error: "Unauthorized" });
  });

  it.each([
    {},
    { BOB_STRIPE_ENABLED: "false" },
    { BOB_STRIPE_ENABLED: "true", STRIPE_SECRET_KEY: "rk_test_fixtureOnly" },
    { SENTRY_DSN: "private-malformed-fixture" },
    {
      SENTRY_DSN: "https://fixturePublicKey@sentry.example/1",
      POSTHOG_KEY: "phc_fixtureOnly",
      GATEWAY_URL: "https://gateway.example",
    },
  ])(
    "returns the validated startup snapshot without credentials",
    async (env) => {
      getSession.mockResolvedValue({ user: { id: "fixture-user" } });
      const log = vi.spyOn(console, "log");
      const warn = vi.spyOn(console, "warn");
      const error = vi.spyOn(console, "error");
      initializeIntegrationConfig(env);
      const request = new Request(
        "https://bob.example/api/integrations/configuration",
        { headers: { cookie: "fixture-session" } },
      );
      const response = await GET(request);
      expect(getSession).toHaveBeenCalledWith({ headers: request.headers });
      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toBe("private, no-store");
      const body = await response.text();
      expect(JSON.parse(body)).toEqual(getIntegrationStatuses());
      for (const [key, value] of Object.entries(env)) {
        if (!key.endsWith("_ENABLED")) expect(body).not.toContain(value);
      }
      expect(log).not.toHaveBeenCalled();
      expect(warn).not.toHaveBeenCalled();
      expect(error).not.toHaveBeenCalled();
    },
  );
});
