// Unit tests for the stateless `RunnerSessions` token minter/validator.
//
// These tests exercise the pure HMAC-signed opaque token format:
//   payload = base64url(JSON.stringify({deviceId, tenantId, issuedAt, expiresAt}))
//   signature = base64url(HMAC-SHA256(HMAC(master, "runner-session"), payload))
//   token = `${payload}.${signature}`
//
// The master key is read from `GMACKO_SECRET_ENCRYPTION_KEY` (same env var as
// `@gmacko/secrets`). These tests mirror the env-var setup pattern from
// `packages/secrets/src/__tests__/crypt.test.ts`.
import { afterEach, beforeEach, describe, expect } from "vitest";
import { it } from "@effect/vitest";
import { Effect } from "effect";

import {
  InvalidRunnerSessionError,
  RunnerSessions,
  layerRunnerSessions,
} from "../runner-sessions.js";

const GOOD_KEY = "0123456789abcdef0123456789abcdef"; // exactly 32 chars

describe("@gmacko/auth RunnerSessions", () => {
  beforeEach(() => {
    process.env.GMACKO_SECRET_ENCRYPTION_KEY = GOOD_KEY;
  });

  afterEach(() => {
    delete process.env.GMACKO_SECRET_ENCRYPTION_KEY;
  });

  it.effect("mint + validate round-trip returns the original claims", () =>
    Effect.gen(function* () {
      const sessions = yield* RunnerSessions;
      const minted = yield* sessions.mint({
        deviceId: "device-abc",
        tenantId: "tenant-xyz",
      });
      expect(minted.token).toBeTypeOf("string");
      expect(minted.token.split(".")).toHaveLength(2);
      expect(minted.expiresAt).toBeInstanceOf(Date);

      const claims = yield* sessions.validate(minted.token);
      expect(claims.deviceId).toBe("device-abc");
      expect(claims.tenantId).toBe("tenant-xyz");
    }).pipe(Effect.provide(layerRunnerSessions)),
  );

  it.effect("expired token fails with reason=expired", () =>
    Effect.gen(function* () {
      const sessions = yield* RunnerSessions;
      const minted = yield* sessions.mint({
        deviceId: "device-exp",
        tenantId: "tenant-exp",
        ttlMs: -1000, // already expired
      });
      const caught = yield* Effect.flip(sessions.validate(minted.token));
      expect(caught).toBeInstanceOf(InvalidRunnerSessionError);
      expect(caught.reason).toBe("expired");
    }).pipe(Effect.provide(layerRunnerSessions)),
  );

  it.effect("tampered signature fails with reason=signature", () =>
    Effect.gen(function* () {
      const sessions = yield* RunnerSessions;
      const minted = yield* sessions.mint({
        deviceId: "device-tamper",
        tenantId: "tenant-tamper",
      });
      const [payloadB64, signature] = minted.token.split(".");
      // Flip the first character of the signature — if it's 'A' make it 'B',
      // otherwise 'A'. Preserves length + base64url alphabet.
      const flipped =
        (signature![0] === "A" ? "B" : "A") + signature!.slice(1);
      const tamperedToken = `${payloadB64}.${flipped}`;

      const caught = yield* Effect.flip(sessions.validate(tamperedToken));
      expect(caught).toBeInstanceOf(InvalidRunnerSessionError);
      expect(caught.reason).toBe("signature");
    }).pipe(Effect.provide(layerRunnerSessions)),
  );

  it.effect("malformed tokens fail with reason=malformed", () =>
    Effect.gen(function* () {
      const sessions = yield* RunnerSessions;

      // Zero dots (no signature segment).
      const noDot = yield* Effect.flip(sessions.validate("nopedot"));
      expect(noDot).toBeInstanceOf(InvalidRunnerSessionError);
      expect(noDot.reason).toBe("malformed");

      // Three dots.
      const threeDots = yield* Effect.flip(
        sessions.validate("a.b.c.d"),
      );
      expect(threeDots.reason).toBe("malformed");

      // Empty string.
      const empty = yield* Effect.flip(sessions.validate(""));
      expect(empty.reason).toBe("malformed");
    }).pipe(Effect.provide(layerRunnerSessions)),
  );

  it("throws at layer-build time if the master key env var is missing or short", async () => {
    // Missing
    delete process.env.GMACKO_SECRET_ENCRYPTION_KEY;
    const missingRun = Effect.runPromise(
      Effect.gen(function* () {
        const sessions = yield* RunnerSessions;
        return yield* sessions.mint({
          deviceId: "x",
          tenantId: "y",
        });
      }).pipe(Effect.provide(layerRunnerSessions)),
    );
    await expect(missingRun).rejects.toThrow(/GMACKO_SECRET_ENCRYPTION_KEY/);

    // Too short
    process.env.GMACKO_SECRET_ENCRYPTION_KEY = "tooShort10";
    const shortRun = Effect.runPromise(
      Effect.gen(function* () {
        const sessions = yield* RunnerSessions;
        return yield* sessions.mint({
          deviceId: "x",
          tenantId: "y",
        });
      }).pipe(Effect.provide(layerRunnerSessions)),
    );
    await expect(shortRun).rejects.toThrow(/32/);
  });
});
