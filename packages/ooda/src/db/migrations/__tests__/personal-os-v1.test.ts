import { describe, expect, it } from "vitest";

import {
  mapLegacySessionEvent,
  parseVerificationRows,
} from "../personal-os-v1";

describe("personal OS legacy research backfill", () => {
  it.each([
    ["prompt", { type: "user_turn", actorType: "user", sensitivity: "general" }],
    ["stdout", { type: "assistant_turn", actorType: "host", sensitivity: "general" }],
    ["stdout_chunk", { type: "assistant_delta", actorType: "host", sensitivity: "general" }],
    ["stderr_chunk", { type: "failure", actorType: "system", sensitivity: "general" }],
    ["error", { type: "failure", actorType: "system", sensitivity: "general" }],
    ["thought", { type: "system_annotation", actorType: "host", sensitivity: "restricted" }],
    ["promotion_available", { type: "proposal", actorType: "system", sensitivity: "general" }],
    ["promote_request", { type: "proposal", actorType: "user", sensitivity: "general" }],
    ["exit", { type: "system_annotation", actorType: "system", sensitivity: "general" }],
  ])("maps %s without losing the legacy type", (legacyType, expected) => {
    expect(mapLegacySessionEvent(legacyType)).toEqual({
      ...expected,
      legacyType,
    });
  });

  it("fails verification when counts or transcript hashes drift", () => {
    expect(
      parseVerificationRows([
        { check: "conversations", source: "38", destination: "38" },
        { check: "transcript_hash", source: "abc", destination: "def" },
      ]),
    ).toEqual({
      ok: false,
      checks: [
        { check: "conversations", source: "38", destination: "38", ok: true },
        { check: "transcript_hash", source: "abc", destination: "def", ok: false },
      ],
    });
  });
});
