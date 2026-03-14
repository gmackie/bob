import { describe, expect, it } from "vitest";

import {
  buildPlanningControlSignature,
  verifyPlanningControlRequest,
} from "../../services/integrations/planningControlVerifier";
import type { PlanningControlAuthError } from "../../services/integrations/planningControlVerifier";
import { getPlanningControlConfig } from "../../services/integrations/planningControlConfig";

describe("Planning control request verification", () => {
  const config = getPlanningControlConfig({
    PLANNING_URL: "https://tasks.example.internal",
    PLANNING_CONTROL_SHARED_SECRET: "super-secret",
    PLANNING_CONTROL_MAX_SKEW_MS: "300000",
  });

  function getAuthError(fn: () => void): PlanningControlAuthError {
    try {
      fn();
    } catch (error) {
      return error as PlanningControlAuthError;
    }

    throw new Error("Expected PlanningControlAuthError to be thrown");
  }

  it("accepts valid signed requests", () => {
    const timestamp = "1710000000000";
    const idempotencyKey = "idem-123";
    const body = JSON.stringify({
      issueId: "550e8400-e29b-41d4-a716-446655440000",
      issueIdentifier: "ENG-123",
    });

    const headers = new Headers({
      "X-Planning-Timestamp": timestamp,
      "Idempotency-Key": idempotencyKey,
      "X-Planning-Signature": buildPlanningControlSignature(
        {
          method: "POST",
          path: "/api/integrations/planning/tasks/start",
          timestamp,
          idempotencyKey,
          body,
        },
        config.sharedSecret,
      ),
    });

    expect(
      verifyPlanningControlRequest(
        {
          method: "POST",
          path: "/api/integrations/planning/tasks/start",
          headers,
          body,
        },
        config,
        {
          now: () => Number(timestamp),
        },
      ),
    ).toEqual({
      timestamp,
      idempotencyKey,
    });
  });

  it("accepts planning-named env vars and headers", () => {
    const planningConfig = getPlanningControlConfig({
      PLANNING_URL: "https://planning.example.internal",
      PLANNING_CONTROL_SHARED_SECRET: "planning-secret",
      PLANNING_CONTROL_MAX_SKEW_MS: "600000",
    });
    const timestamp = "1710000000000";
    const idempotencyKey = "idem-planning-123";
    const body = JSON.stringify({
      taskId: "550e8400-e29b-41d4-a716-446655440000",
      taskIdentifier: "BUILD-123",
    });

    const headers = new Headers({
      "X-Planning-Timestamp": timestamp,
      "Idempotency-Key": idempotencyKey,
      "X-Planning-Signature": buildPlanningControlSignature(
        {
          method: "POST",
          path: "/api/integrations/planning/tasks/start",
          timestamp,
          idempotencyKey,
          body,
        },
        planningConfig.sharedSecret,
      ),
    });

    expect(planningConfig).toEqual({
      baseUrl: "https://planning.example.internal",
      sharedSecret: "planning-secret",
      maxSkewMs: 600000,
    });
    expect(
      verifyPlanningControlRequest(
        {
          method: "POST",
          path: "/api/integrations/planning/tasks/start",
          headers,
          body,
        },
        planningConfig,
        {
          now: () => Number(timestamp),
        },
      ),
    ).toEqual({
      timestamp,
      idempotencyKey,
    });
  });

  it("rejects stale requests", () => {
    const timestamp = "1710000000000";
    const idempotencyKey = "idem-123";
    const body = JSON.stringify({
      issueId: "550e8400-e29b-41d4-a716-446655440000",
    });

    const headers = new Headers({
      "X-Planning-Timestamp": timestamp,
      "Idempotency-Key": idempotencyKey,
      "X-Planning-Signature": buildPlanningControlSignature(
        {
          method: "POST",
          path: "/api/integrations/planning/tasks/start",
          timestamp,
          idempotencyKey,
          body,
        },
        config.sharedSecret,
      ),
    });

    const error = getAuthError(() =>
      verifyPlanningControlRequest(
        {
          method: "POST",
          path: "/api/integrations/planning/tasks/start",
          headers,
          body,
        },
        config,
        {
          now: () => Number(timestamp) + config.maxSkewMs + 1,
        },
      ),
    );

    expect(error.code).toBe("STALE_REQUEST");
  });

  it("rejects tampered requests", () => {
    const timestamp = "1710000000000";
    const idempotencyKey = "idem-123";
    const body = JSON.stringify({
      issueId: "550e8400-e29b-41d4-a716-446655440000",
    });

    const headers = new Headers({
      "X-Planning-Timestamp": timestamp,
      "Idempotency-Key": idempotencyKey,
      "X-Planning-Signature": buildPlanningControlSignature(
        {
          method: "POST",
          path: "/api/integrations/planning/tasks/start",
          timestamp,
          idempotencyKey,
          body,
        },
        config.sharedSecret,
      ),
    });

    const error = getAuthError(() =>
      verifyPlanningControlRequest(
        {
          method: "POST",
          path: "/api/integrations/planning/tasks/start",
          headers,
          body: JSON.stringify({
            issueId: "550e8400-e29b-41d4-a716-446655440001",
          }),
        },
        config,
        {
          now: () => Number(timestamp),
        },
      ),
    );

    expect(error.code).toBe("INVALID_SIGNATURE");
  });

  it("rejects requests without an idempotency key", () => {
    const timestamp = "1710000000000";
    const body = JSON.stringify({
      issueId: "550e8400-e29b-41d4-a716-446655440000",
    });

    const headers = new Headers({
      "X-Planning-Timestamp": timestamp,
      "X-Planning-Signature": buildPlanningControlSignature(
        {
          method: "POST",
          path: "/api/integrations/planning/tasks/start",
          timestamp,
          idempotencyKey: "idem-123",
          body,
        },
        config.sharedSecret,
      ),
    });

    const error = getAuthError(() =>
      verifyPlanningControlRequest(
        {
          method: "POST",
          path: "/api/integrations/planning/tasks/start",
          headers,
          body,
        },
        config,
        {
          now: () => Number(timestamp),
        },
      ),
    );

    expect(error.code).toBe("MISSING_IDEMPOTENCY_KEY");
  });
});
