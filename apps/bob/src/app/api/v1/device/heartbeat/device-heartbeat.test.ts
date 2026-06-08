import { describe, expect, it } from "vitest";

import {
  buildDeviceHeartbeatResponse,
  canUseDeviceHeartbeat,
  extractBearerToken,
} from "./device-heartbeat";

describe("device heartbeat contract", () => {
  it("extracts bearer tokens for device API key auth", () => {
    const request = new Request("https://bob.example.com/api/v1/device/heartbeat", {
      headers: {
        authorization: "Bearer bob_test_key",
      },
    });

    expect(extractBearerToken(request)).toBe("bob_test_key");
  });

  it("requires read permission for GET and write permission for POST", () => {
    expect(canUseDeviceHeartbeat(["read"], "GET")).toBe(true);
    expect(canUseDeviceHeartbeat(["read"], "POST")).toBe(false);
    expect(canUseDeviceHeartbeat(["write"], "POST")).toBe(true);
    expect(canUseDeviceHeartbeat(["admin"], "POST")).toBe(true);
  });

  it("returns active sessions and selects the most recent active session", () => {
    const response = buildDeviceHeartbeatResponse([
      {
        id: "stopped-session",
        title: "Old stopped session",
        agentType: "codex",
        status: "stopped",
        lastActivityAt: "2026-06-08T12:00:00.000Z",
        updatedAt: "2026-06-08T12:00:00.000Z",
      },
      {
        id: "ready-session",
        title: "Ready for voice",
        agentType: "codex",
        status: "running",
        lastActivityAt: "2026-06-08T12:01:00.000Z",
        updatedAt: "2026-06-08T12:01:00.000Z",
      },
    ]);

    expect(response).toEqual({
      ok: true,
      selectedSession: {
        id: "ready-session",
        title: "Ready for voice",
        agentType: "codex",
        status: "running",
        lastActivityAt: "2026-06-08T12:01:00.000Z",
      },
      sessions: [
        {
          id: "ready-session",
          title: "Ready for voice",
          agentType: "codex",
          status: "running",
          lastActivityAt: "2026-06-08T12:01:00.000Z",
        },
        {
          id: "stopped-session",
          title: "Old stopped session",
          agentType: "codex",
          status: "stopped",
          lastActivityAt: "2026-06-08T12:00:00.000Z",
        },
      ],
    });
  });
});
