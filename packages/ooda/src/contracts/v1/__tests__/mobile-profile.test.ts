import { describe, expect, it } from "vitest";

import {
  MOBILE_V1_CORPUS,
  forbiddenFieldProbes,
} from "../fixtures/mobile-v1";
import {
  OODA_MOBILE_PROFILE_V1,
  OodaMobileClientHelloV1Schema,
  OodaMobileProfileV1Schema,
  mergeCoverageV1,
  negotiateMobileProfileV1,
  type OodaMobileProfileV1,
} from "../mobile-profile";

const server = (
  overrides: Partial<OodaMobileProfileV1> = {},
): OodaMobileProfileV1 =>
  OodaMobileProfileV1Schema.parse({
    ...MOBILE_V1_CORPUS.serverProfile.complete,
    ...overrides,
  });

describe("mobile profile v1 — shape", () => {
  it("accepts the canonical server profile", () => {
    expect(() => server()).not.toThrow();
  });

  // The whole point of .strict(): a client cannot smuggle content-shaped
  // payload into what must stay a capability announcement.
  it.each(forbiddenFieldProbes())(
    "rejects an unknown key: %s",
    (_label, payload) => {
      const result = OodaMobileProfileV1Schema.safeParse(payload);
      expect(result.success).toBe(false);
    },
  );

  it("rejects a profile id it does not serve", () => {
    const result = OodaMobileProfileV1Schema.safeParse({
      ...MOBILE_V1_CORPUS.serverProfile.complete,
      profile: "ooda-mobile-v2",
    });
    expect(result.success).toBe(false);
  });

  it("rejects an inverted compatibility window", () => {
    const result = OodaMobileProfileV1Schema.safeParse({
      ...MOBILE_V1_CORPUS.serverProfile.complete,
      compatibility: { minimumClient: 3, maximumClient: 1 },
    });
    expect(result.success).toBe(false);
  });

  it("treats the event cursor as opaque and bounded", () => {
    expect(
      OodaMobileProfileV1Schema.safeParse({
        ...MOBILE_V1_CORPUS.serverProfile.complete,
        eventCursor: "x".repeat(4_097),
      }).success,
    ).toBe(false);
  });
});

describe("mobile profile v1 — negotiation", () => {
  const hello = (contractVersion: number, profile = OODA_MOBILE_PROFILE_V1) =>
    OodaMobileClientHelloV1Schema.parse({ profile, contractVersion });

  it("accepts a client inside the window", () => {
    const result = negotiateMobileProfileV1(hello(1), server());
    expect(result).toEqual({ outcome: "accepted", contractVersion: 1 });
  });

  it("accepts the previous version — the window is current-and-previous", () => {
    const s = server({ compatibility: { minimumClient: 1, maximumClient: 2 } });
    expect(negotiateMobileProfileV1(hello(1), s).outcome).toBe("accepted");
    expect(negotiateMobileProfileV1(hello(2), s).outcome).toBe("accepted");
  });

  it("rejects a client below the published floor", () => {
    const s = server({ compatibility: { minimumClient: 2, maximumClient: 3 } });
    const result = negotiateMobileProfileV1(hello(1), s);
    expect(result).toMatchObject({ outcome: "rejected", reason: "below_floor" });
  });

  // Client shipped ahead of server — a deploy-order mistake. Reject rather
  // than guess, so the failure names itself instead of surfacing as odd
  // behaviour in the app.
  it("rejects a client the server does not yet understand", () => {
    const result = negotiateMobileProfileV1(hello(9), server());
    expect(result).toMatchObject({
      outcome: "rejected",
      reason: "above_ceiling",
    });
  });

  it("rejects a mismatched profile id", () => {
    const result = negotiateMobileProfileV1(
      { profile: OODA_MOBILE_PROFILE_V1, contractVersion: 1 },
      server({ profile: OODA_MOBILE_PROFILE_V1 }),
    );
    expect(result.outcome).toBe("accepted");

    const mismatched = negotiateMobileProfileV1(
      // Cast: the schema forbids this, but the runtime guard must still hold
      // for a hand-built object arriving off the wire.
      { profile: "ooda-mobile-v2", contractVersion: 1 } as never,
      server(),
    );
    expect(mismatched).toMatchObject({
      outcome: "rejected",
      reason: "wrong_profile",
    });
  });

  it("explains every rejection", () => {
    const s = server({ compatibility: { minimumClient: 2, maximumClient: 2 } });
    const result = negotiateMobileProfileV1(hello(1), s);
    if (result.outcome !== "rejected") throw new Error("expected rejection");
    expect(result.detail).toMatch(/floor/);
    expect(result.detail.length).toBeGreaterThan(20);
  });
});

describe("mobile profile v1 — coverage", () => {
  it("reports complete only when every part is complete", () => {
    expect(mergeCoverageV1(["complete", "complete"])).toBe("complete");
    expect(mergeCoverageV1([])).toBe("complete");
  });

  it("never coerces unknown up to complete", () => {
    expect(mergeCoverageV1(["complete", "unknown"])).toBe("unknown");
    expect(mergeCoverageV1(["partial", "unknown"])).toBe("unknown");
  });

  it("degrades to partial when any part is partial", () => {
    expect(mergeCoverageV1(["complete", "partial", "complete"])).toBe("partial");
  });
});

describe("mobile profile v1 — golden corpus", () => {
  it("covers the failure cases, not just the happy path", () => {
    // A corpus of only happy paths is the failure mode this guards against:
    // it passes forever and catches nothing.
    expect(Object.keys(MOBILE_V1_CORPUS.serverProfile).sort()).toEqual([
      "complete",
      "degraded",
      "unknown",
    ]);
    expect(Object.keys(MOBILE_V1_CORPUS.negotiation).sort()).toEqual([
      "aboveCeiling",
      "belowFloor",
      "currentClient",
      "previousClient",
    ]);
  });

  it("every server-profile fixture parses", () => {
    for (const [name, fixture] of Object.entries(
      MOBILE_V1_CORPUS.serverProfile,
    )) {
      const result = OodaMobileProfileV1Schema.safeParse(fixture);
      expect(result.success, `fixture ${name} should parse`).toBe(true);
    }
  });

  it("every negotiation fixture reaches its recorded outcome", () => {
    for (const [name, entry] of Object.entries(MOBILE_V1_CORPUS.negotiation)) {
      const result = negotiateMobileProfileV1(
        entry.hello,
        OodaMobileProfileV1Schema.parse(entry.server),
      );
      expect(result.outcome, `fixture ${name}`).toBe(entry.expected.outcome);
      if (entry.expected.outcome === "rejected") {
        expect(result).toMatchObject({ reason: entry.expected.reason });
      }
    }
  });

  it("carries no content-shaped payload", () => {
    // Telemetry and capability announcements must never carry conversation
    // text, identity or paths. Pinning it on the corpus keeps a future
    // fixture author from casually adding a realistic-looking message.
    const serialized = JSON.stringify(MOBILE_V1_CORPUS);
    for (const forbidden of [
      "@",
      "/Users/",
      "/home/",
      "password",
      "Bearer ",
    ]) {
      expect(serialized, `corpus must not contain ${forbidden}`).not.toContain(
        forbidden,
      );
    }
  });
});
