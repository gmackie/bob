import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  formatSessionOption,
  isDeviceOnline,
  normalizeDeviceHeartbeatPayload,
  readSelectedSessionId,
  writeSelectedSessionId,
} from "./device-heartbeat";

describe("device heartbeat metadata", () => {
  it("normalizes handheld heartbeat details", () => {
    assert.deepEqual(
      normalizeDeviceHeartbeatPayload({
        deviceName: "  Whisplay Bob handheld  ",
        state: "agent_ready",
        message: "  Agent ready  ",
        wifi: "Wi-Fi: gmac-travel-priv online",
        batteryPercent: 87,
        details: { stt: "vosk", tts: "piper:brief" },
      }),
      {
        deviceName: "Whisplay Bob handheld",
        state: "agent_ready",
        message: "Agent ready",
        wifi: "Wi-Fi: gmac-travel-priv online",
        batteryPercent: 87,
        details: { stt: "vosk", tts: "piper:brief" },
      },
    );
  });

  it("bounds optional fields and ignores invalid details", () => {
    assert.deepEqual(
      normalizeDeviceHeartbeatPayload({
        deviceName: "x".repeat(200),
        state: "",
        message: "m".repeat(1000),
        wifi: 42,
        batteryPercent: 140,
        details: ["not", "an", "object"],
      }),
      {
        deviceName: "x".repeat(100),
        state: "unknown",
        message: "m".repeat(500),
        wifi: null,
        batteryPercent: null,
        details: {},
      },
    );
  });

  it("treats devices seen within five minutes as online", () => {
    const now = new Date("2026-06-07T03:30:00Z");

    assert.equal(isDeviceOnline("2026-06-07T03:26:00Z", now), true);
    assert.equal(isDeviceOnline("2026-06-07T03:20:00Z", now), false);
    assert.equal(isDeviceOnline(null, now), false);
  });

  it("formats existing Bob sessions for handheld selection", () => {
    assert.deepEqual(
      formatSessionOption({
        id: "session-1",
        title: "  GMA-101: Competitive map  ",
        agentType: "codex",
        sessionType: "execution",
        status: "completed",
        updatedAt: "2026-06-07T03:15:00Z",
        lastActivityAt: null,
        createdAt: "2026-06-07T03:00:00Z",
      }),
      {
        id: "session-1",
        title: "GMA-101: Competitive map",
        subtitle: "codex / execution / completed",
        updatedAt: "2026-06-07T03:15:00Z",
      },
    );
  });

  it("falls back when a session has no title or update time", () => {
    assert.deepEqual(
      formatSessionOption({
        id: "session-2",
        title: null,
        agentType: "claude",
        sessionType: "planning",
        status: "running",
        updatedAt: null,
        lastActivityAt: null,
        createdAt: "2026-06-07T03:00:00Z",
      }),
      {
        id: "session-2",
        title: "Untitled session",
        subtitle: "claude / planning / running",
        updatedAt: "2026-06-07T03:00:00Z",
      },
    );
  });

  it("stores selected session metadata inside heartbeat details", () => {
    const details = writeSelectedSessionId({ stt: "vosk" }, "session-1");

    assert.deepEqual(details, {
      stt: "vosk",
      selectedSessionId: "session-1",
    });
    assert.equal(readSelectedSessionId(details), "session-1");
    assert.equal(
      readSelectedSessionId(writeSelectedSessionId(details, null)),
      null,
    );
  });
});
