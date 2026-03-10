import { describe, expect, it } from "vitest";

import {
  buildKanbangerControlSignature,
  verifyKanbangerControlRequest,
} from "../../services/integrations/kanbangerVerifier";
import type { KanbangerControlAuthError } from "../../services/integrations/kanbangerVerifier";
import { getKanbangerControlConfig } from "../../services/integrations/kanbangerConfig";

describe("Kanbanger control request verification", () => {
  const config = getKanbangerControlConfig({
    KANBANGER_URL: "https://tasks.example.internal",
    KANBANGER_CONTROL_SHARED_SECRET: "super-secret",
    KANBANGER_CONTROL_MAX_SKEW_MS: "300000",
  });

  function getAuthError(fn: () => void): KanbangerControlAuthError {
    try {
      fn();
    } catch (error) {
      return error as KanbangerControlAuthError;
    }

    throw new Error("Expected KanbangerControlAuthError to be thrown");
  }

  it("accepts valid signed requests", () => {
    const timestamp = "1710000000000";
    const idempotencyKey = "idem-123";
    const body = JSON.stringify({
      issueId: "550e8400-e29b-41d4-a716-446655440000",
      issueIdentifier: "ENG-123",
    });

    const headers = new Headers({
      "X-Kanbanger-Timestamp": timestamp,
      "Idempotency-Key": idempotencyKey,
      "X-Kanbanger-Signature": buildKanbangerControlSignature(
        {
          method: "POST",
          path: "/api/integrations/kanbanger/issues/start",
          timestamp,
          idempotencyKey,
          body,
        },
        config.sharedSecret,
      ),
    });

    expect(
      verifyKanbangerControlRequest(
        {
          method: "POST",
          path: "/api/integrations/kanbanger/issues/start",
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

  it("rejects stale requests", () => {
    const timestamp = "1710000000000";
    const idempotencyKey = "idem-123";
    const body = JSON.stringify({
      issueId: "550e8400-e29b-41d4-a716-446655440000",
    });

    const headers = new Headers({
      "X-Kanbanger-Timestamp": timestamp,
      "Idempotency-Key": idempotencyKey,
      "X-Kanbanger-Signature": buildKanbangerControlSignature(
        {
          method: "POST",
          path: "/api/integrations/kanbanger/issues/start",
          timestamp,
          idempotencyKey,
          body,
        },
        config.sharedSecret,
      ),
    });

    const error = getAuthError(() =>
      verifyKanbangerControlRequest(
        {
          method: "POST",
          path: "/api/integrations/kanbanger/issues/start",
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
      "X-Kanbanger-Timestamp": timestamp,
      "Idempotency-Key": idempotencyKey,
      "X-Kanbanger-Signature": buildKanbangerControlSignature(
        {
          method: "POST",
          path: "/api/integrations/kanbanger/issues/start",
          timestamp,
          idempotencyKey,
          body,
        },
        config.sharedSecret,
      ),
    });

    const error = getAuthError(() =>
      verifyKanbangerControlRequest(
        {
          method: "POST",
          path: "/api/integrations/kanbanger/issues/start",
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
      "X-Kanbanger-Timestamp": timestamp,
      "X-Kanbanger-Signature": buildKanbangerControlSignature(
        {
          method: "POST",
          path: "/api/integrations/kanbanger/issues/start",
          timestamp,
          idempotencyKey: "idem-123",
          body,
        },
        config.sharedSecret,
      ),
    });

    const error = getAuthError(() =>
      verifyKanbangerControlRequest(
        {
          method: "POST",
          path: "/api/integrations/kanbanger/issues/start",
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
