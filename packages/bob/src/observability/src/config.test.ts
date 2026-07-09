import { describe, expect, it } from "vitest";

import { resolveObservabilityConfig, getSentryInitOptions } from "./config.js";
import { buildFailurePayload, getFailureEventName } from "./failures.js";
import { getAlertsForSurface, OBSERVABILITY_ALERTS } from "./alerts.js";

describe("resolveObservabilityConfig", () => {
  it("enables sentry and posthog when env vars are present", () => {
    const config = resolveObservabilityConfig({
      serviceName: "bob-ws-gateway",
      env: {
        SENTRY_DSN: "https://sentry.example/1",
        POSTHOG_KEY: "phc_test",
        POSTHOG_HOST: "https://eu.i.posthog.com",
        FG_STAGE: "production",
        BOB_TENANT_ID: "tenant-1",
      },
    });

    expect(config.sentry.enabled).toBe(true);
    expect(config.posthog.enabled).toBe(true);
    expect(config.environment).toBe("production");
    expect(config.tenantId).toBe("tenant-1");
    expect(getSentryInitOptions(config)).toEqual({
      dsn: "https://sentry.example/1",
      environment: "production",
      tracesSampleRate: 0.1,
      enabled: true,
    });
  });

  it("stays disabled without credentials", () => {
    const config = resolveObservabilityConfig({
      serviceName: "bob-execution",
      env: {},
    });

    expect(config.sentry.enabled).toBe(false);
    expect(config.posthog.enabled).toBe(false);
  });
});

describe("failure helpers", () => {
  it("builds a payload with identity and alert metadata", () => {
    const payload = buildFailurePayload({
      surface: "gateway",
      operation: "persist_batch",
      error: new Error("connection refused"),
      alertId: "gateway-persistence-failure",
      user: { userId: "user-1", email: "ops@example.com" },
      tenant: { tenantId: "tenant-1", workspaceId: "ws-1" },
      metadata: { batchSize: 50 },
    });

    expect(payload.surface).toBe("gateway");
    expect(payload.alert_id).toBe("gateway-persistence-failure");
    expect(payload.user_id).toBe("user-1");
    expect(payload.tenant_id).toBe("tenant-1");
    expect(payload.batchSize).toBe(50);
    expect(getFailureEventName({
      surface: "gateway",
      operation: "persist_batch",
      error: "x",
      alertId: "gateway-persistence-failure",
    })).toBe("critical_gateway_failure");
  });
});

describe("alert catalog", () => {
  it("covers all critical surfaces", () => {
    const apiAlerts = getAlertsForSurface("api");
    const jobAlerts = getAlertsForSurface("job");
    const gatewayAlerts = getAlertsForSurface("gateway");
    expect(apiAlerts.length).toBeGreaterThan(0);
    expect(jobAlerts.length).toBeGreaterThan(0);
    expect(gatewayAlerts.length).toBeGreaterThan(0);
    expect(OBSERVABILITY_ALERTS.every((alert) => alert.runbook.length > 0)).toBe(true);
  });
});
