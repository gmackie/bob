import { describe, it, expect } from "vitest";

import { oodaCallbackFrom, buildOodaOutcomeBody } from "./ooda-callback.js";

describe("oodaCallbackFrom", () => {
  it("extracts a valid callback nested under personaConfig.metadata.ooda", () => {
    expect(
      oodaCallbackFrom({
        personaConfig: {
          metadata: { ooda: { threadId: "t1", callbackUrl: "https://ooda.example/cb" } },
        },
      }),
    ).toEqual({ threadId: "t1", callbackUrl: "https://ooda.example/cb" });
  });

  // Dark by default: any session without a proper ooda callback → null → no-op.
  it("returns null for a session with no ooda metadata (the common case)", () => {
    expect(oodaCallbackFrom({})).toBeNull();
    expect(oodaCallbackFrom({ personaConfig: {} })).toBeNull();
    expect(oodaCallbackFrom({ personaConfig: { metadata: {} } })).toBeNull();
    expect(oodaCallbackFrom({ personaConfig: { metadata: { bizpulse: {} } } })).toBeNull();
  });

  it("rejects a missing/blank threadId", () => {
    expect(
      oodaCallbackFrom({ personaConfig: { metadata: { ooda: { callbackUrl: "https://x/cb" } } } }),
    ).toBeNull();
    expect(
      oodaCallbackFrom({ personaConfig: { metadata: { ooda: { threadId: "  ", callbackUrl: "https://x/cb" } } } }),
    ).toBeNull();
  });

  it("rejects a non-http callbackUrl (no javascript:/file:/relative)", () => {
    for (const callbackUrl of ["javascript:alert(1)", "file:///etc", "/relative", "ftp://x", "", 123]) {
      expect(
        oodaCallbackFrom({ personaConfig: { metadata: { ooda: { threadId: "t1", callbackUrl } } } }),
      ).toBeNull();
    }
  });
});

describe("buildOodaOutcomeBody", () => {
  it("carries threadId + outcome, defaulting optionals to null", () => {
    expect(
      buildOodaOutcomeBody(
        { threadId: "t1", callbackUrl: "https://x/cb" },
        { externalSessionId: "s1", status: "completed", title: "Do X", pullRequestUrl: "https://pr/1", branch: "b" },
      ),
    ).toEqual({
      threadId: "t1",
      externalSessionId: "s1",
      status: "completed",
      title: "Do X",
      pullRequestUrl: "https://pr/1",
      branch: "b",
    });
    expect(
      buildOodaOutcomeBody(
        { threadId: "t1", callbackUrl: "https://x/cb" },
        { externalSessionId: "s1", status: "failed" },
      ),
    ).toEqual({
      threadId: "t1",
      externalSessionId: "s1",
      status: "failed",
      title: null,
      pullRequestUrl: null,
      branch: null,
    });
  });
});
