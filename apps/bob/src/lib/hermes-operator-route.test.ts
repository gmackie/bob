import { describe, expect, it, vi } from "vitest";

import {
  handleHermesOperatorRequest,
  HermesOperatorUnavailableError,
  type HermesOperatorRouteAuth,
} from "./hermes-operator-route";
import { HermesIntentUnavailableError } from "./hermes-operator";

const captureIntent = {
  schemaVersion: 1,
  requestId: "telegram:4512:9918",
  intent: "capture",
  channel: "telegram",
  occurredAt: "2026-08-21T13:30:00Z",
  payload: { text: "Remember the lab workflow." },
} as const;

function request(body: unknown, token = "bob_test_key") {
  return new Request("https://bob.example.com/api/v1/hermes/operator", {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

function auth(permissions: HermesOperatorRouteAuth["permissions"]) {
  return {
    keyId: "key-1",
    userId: "user-1",
    permissions,
  } satisfies HermesOperatorRouteAuth;
}

describe("Hermes operator route", () => {
  it("returns a canonical receipt for an authenticated capture", async () => {
    const handle = vi.fn(async () => ({
      schemaVersion: 1,
      intent: "capture.receipt",
      riskClass: "R1",
      summary: "Captured in OODA.",
      owner: "ooda",
      canonicalRef: { kind: "conversation_event", id: "event-42" },
      freshness: {
        observedAt: "2026-08-21T13:30:00Z",
        coverage: "complete",
      },
      approval: { required: false },
    }));
    const authenticate = vi.fn(async () => auth(["write"]));
    const createService = vi.fn(() => ({ handle }));

    const response = await handleHermesOperatorRequest(request(captureIntent), {
      authenticate,
      createService,
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      schemaVersion: 1,
      intent: "capture.receipt",
      canonicalRef: { kind: "conversation_event", id: "event-42" },
    });
    expect(authenticate).toHaveBeenCalledWith("bob_test_key");
    expect(createService).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-1",
      }),
    );
    expect(handle).toHaveBeenCalledWith(captureIntent);
  });

  it("requires a valid bearer API key", async () => {
    const authenticate = vi.fn(async () => null);
    const createService = vi.fn();
    const noToken = new Request(
      "https://bob.example.com/api/v1/hermes/operator",
      { method: "POST" },
    );

    const missing = await handleHermesOperatorRequest(noToken, {
      authenticate,
      createService,
    });
    const invalid = await handleHermesOperatorRequest(
      request(captureIntent, "bob_invalid_key"),
      { authenticate, createService },
    );

    expect(missing.status).toBe(401);
    expect(invalid.status).toBe(401);
    expect(createService).not.toHaveBeenCalled();
  });

  it("requires write permission for capture and read permission for queries", async () => {
    const handle = vi.fn(async () => ({ ok: true }));
    const createService = vi.fn(() => ({ handle }));
    const readOnly = vi.fn(async () => auth(["read"]));

    const captureResponse = await handleHermesOperatorRequest(
      request(captureIntent),
      { authenticate: readOnly, createService },
    );
    const todayResponse = await handleHermesOperatorRequest(
      request({
        ...captureIntent,
        requestId: "today-1",
        intent: "today",
        payload: {},
      }),
      { authenticate: readOnly, createService },
    );

    expect(captureResponse.status).toBe(403);
    expect(todayResponse.status).toBe(200);
    expect(handle).toHaveBeenCalledTimes(1);
  });

  it("rejects malformed and excess input before invoking the service", async () => {
    const handle = vi.fn();
    const response = await handleHermesOperatorRequest(
      request({ ...captureIntent, actor: "someone-else" }),
      {
        authenticate: vi.fn(async () => auth(["write"])),
        createService: vi.fn(() => ({ handle })),
      },
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "invalid_request",
    });
    expect(handle).not.toHaveBeenCalled();
  });

  it("distinguishes unavailable adapters from sanitized dependency failures", async () => {
    const authenticate = vi.fn(async () => auth(["read"]));
    const unavailable = await handleHermesOperatorRequest(
      request({
        ...captureIntent,
        requestId: "status-1",
        intent: "status",
        payload: { query: "release" },
      }),
      {
        authenticate,
        createService: () => ({
          handle: vi.fn(async () => {
            throw new HermesIntentUnavailableError("status");
          }),
        }),
      },
    );
    const failed = await handleHermesOperatorRequest(
      request({
        ...captureIntent,
        requestId: "today-1",
        intent: "today",
        payload: {},
      }),
      {
        authenticate,
        createService: () => ({
          handle: vi.fn(async () => {
            throw new Error("upstream secret and raw response");
          }),
        }),
      },
    );

    expect(unavailable.status).toBe(501);
    await expect(unavailable.json()).resolves.toEqual({
      error: "intent_unavailable",
      intent: "status",
    });
    expect(failed.status).toBe(502);
    await expect(failed.json()).resolves.toEqual({
      error: "dependency_failed",
    });
  });

  it("reports missing runtime configuration only after authentication", async () => {
    const authenticate = vi.fn(async () => auth(["write"]));
    const unavailable = vi.fn(() => {
      throw new HermesOperatorUnavailableError();
    });

    const authorized = await handleHermesOperatorRequest(
      request(captureIntent),
      {
        authenticate,
        createService: unavailable,
      },
    );
    const unauthorized = await handleHermesOperatorRequest(
      new Request("https://bob.example.com/api/v1/hermes/operator", {
        method: "POST",
      }),
      { authenticate, createService: unavailable },
    );

    expect(authorized.status).toBe(503);
    expect(unauthorized.status).toBe(401);
    expect(unavailable).toHaveBeenCalledTimes(1);
  });
});
