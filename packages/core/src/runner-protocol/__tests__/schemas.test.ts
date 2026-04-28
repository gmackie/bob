import { describe, expect, it } from "vitest";
import { Schema } from "effect";
import {
  InvalidApiKeyForRunnerError,
  RunnerNotRegisteredError,
  TaskRunEventSchema,
  TaskRunEventTypeSchema,
  TaskRunNotClaimableError,
  TaskRunSchema,
  type TaskRunEventWire,
  type TaskRunWire,
} from "../schemas.js";

describe("@gmacko/runner-protocol wire schemas", () => {
  it("round-trips a TaskRun (encode -> decode deep equal)", () => {
    const now = new Date("2026-04-19T12:00:00.000Z");
    const claimedAt = new Date("2026-04-19T12:00:05.000Z");
    const startedAt = new Date("2026-04-19T12:00:06.000Z");

    const original: TaskRunWire = {
      id: "11111111-1111-4111-8111-111111111111",
      tenantId: "22222222-2222-4222-8222-222222222222",
      status: "running",
      capabilitiesRequired: ["claude-code", "git-push"],
      claimedByDeviceId: "33333333-3333-4333-8333-333333333333",
      input: { prompt: "hello", maxTokens: 512 },
      result: null,
      errorMessage: null,
      claimedAt,
      startedAt,
      completedAt: null,
      createdAt: now,
      updatedAt: now,
    };

    const encoded = Schema.encodeSync(TaskRunSchema)(original);
    const decoded = Schema.decodeUnknownSync(TaskRunSchema)(encoded);

    expect(decoded).toEqual(original);
  });

  it("validates all 7 TaskRunEvent types and rejects unknown types", () => {
    const eventTypes = [
      "status_change",
      "stdout",
      "stderr",
      "tool_call",
      "tool_result",
      "error",
      "metric",
    ] as const;

    const now = new Date("2026-04-19T12:00:00.000Z");

    for (const type of eventTypes) {
      const event: TaskRunEventWire = {
        id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        runId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        seq: 1,
        type,
        payload: { note: "ok" },
        createdAt: now,
      };
      const encoded = Schema.encodeSync(TaskRunEventSchema)(event);
      const decoded = Schema.decodeUnknownSync(TaskRunEventSchema)(encoded);
      expect(decoded.type).toBe(type);
    }

    // Also assert the event type literal union itself rejects rubbish
    expect(() =>
      Schema.decodeUnknownSync(TaskRunEventTypeSchema)("unknown_thing"),
    ).toThrow();

    // A full event row with an unknown type should fail to decode too
    expect(() =>
      Schema.decodeUnknownSync(TaskRunEventSchema)({
        id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        runId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        seq: 1,
        type: "unknown_thing",
        payload: {},
        createdAt: now.toISOString(),
      }),
    ).toThrow();
  });

  it("rejects a TaskRun with an invalid status", () => {
    const now = new Date("2026-04-19T12:00:00.000Z");
    expect(() =>
      Schema.decodeUnknownSync(TaskRunSchema)({
        id: "11111111-1111-4111-8111-111111111111",
        tenantId: "22222222-2222-4222-8222-222222222222",
        status: "bogus",
        capabilitiesRequired: [],
        claimedByDeviceId: null,
        input: {},
        result: null,
        errorMessage: null,
        claimedAt: null,
        startedAt: null,
        completedAt: null,
        createdAt: now,
        updatedAt: now,
      }),
    ).toThrow();
  });

  it("constructs tagged errors that carry their fields and tags", () => {
    const notRegistered = new RunnerNotRegisteredError({
      deviceId: "33333333-3333-4333-8333-333333333333",
    });
    expect(notRegistered._tag).toBe("RunnerNotRegisteredError");
    expect(notRegistered.deviceId).toBe(
      "33333333-3333-4333-8333-333333333333",
    );

    const invalidKey = new InvalidApiKeyForRunnerError({
      message: "api key revoked",
    });
    expect(invalidKey._tag).toBe("InvalidApiKeyForRunnerError");
    expect(invalidKey.message).toBe("api key revoked");

    const notClaimable = new TaskRunNotClaimableError({
      runId: "44444444-4444-4444-8444-444444444444",
      reason: "already claimed",
    });
    expect(notClaimable._tag).toBe("TaskRunNotClaimableError");
    expect(notClaimable.runId).toBe("44444444-4444-4444-8444-444444444444");
    expect(notClaimable.reason).toBe("already claimed");
  });
});
