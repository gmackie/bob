import { describe, expect, it } from "vitest";

import {
  applyRuntimeAuthEnv,
  getHyperdriveConnectionString,
  getSentryOptions,
} from "./runtime-env";
import { wrapFetch } from "./lib/otel";

describe("worker runtime env helpers", () => {
  it("copies Cloudflare auth bindings into the Node-compatible environment", () => {
    const target: Record<string, string | undefined> = {};

    applyRuntimeAuthEnv(
      {
        BOB_AUTH_BYPASS: "true",
        BOB_AUTH_BYPASS_TOKEN: "prod-secret",
        BOB_AUTH_BYPASS_USER_ID: "default-user",
      },
      target,
    );

    expect(target).toEqual({
      BOB_AUTH_BYPASS: "true",
      BOB_AUTH_BYPASS_TOKEN: "prod-secret",
      BOB_AUTH_BYPASS_USER_ID: "default-user",
    });
  });

  it("falls back to process.env when Cloudflare env is not provided", () => {
    const oldDatabaseUrl = process.env.DATABASE_URL;
    const oldSentryDsn = process.env.SENTRY_DSN;
    const oldStage = process.env.FG_STAGE;
    try {
      process.env.DATABASE_URL = "postgres://node-hosted";
      process.env.SENTRY_DSN = "https://sentry.example/1";
      process.env.FG_STAGE = "hetzner";

      expect(getSentryOptions(undefined)).toEqual({
        dsn: "https://sentry.example/1",
        environment: "hetzner",
        tracesSampleRate: 0.1,
      });
      expect(getHyperdriveConnectionString(undefined)).toEqual({
        connectionString: "postgres://node-hosted",
        isHyperdrive: false,
      });
    } finally {
      if (oldDatabaseUrl === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = oldDatabaseUrl;
      if (oldSentryDsn === undefined) delete process.env.SENTRY_DSN;
      else process.env.SENTRY_DSN = oldSentryDsn;
      if (oldStage === undefined) delete process.env.FG_STAGE;
      else process.env.FG_STAGE = oldStage;
    }
  });

  it("wrapFetch tolerates a missing Cloudflare env in Node-hosted vinext", async () => {
    const response = await wrapFetch(async () => new Response("ok"))(
      new Request("http://127.0.0.1/api/health"),
      undefined as never,
      { waitUntil() {} },
    );

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("ok");
  });
});
