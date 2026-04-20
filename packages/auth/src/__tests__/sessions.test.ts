import { afterEach, beforeEach, describe, expect } from "vitest";
import { it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import { createTestDb } from "@gmacko/db/testing";
import { layerGmackoDb } from "@gmacko/db";
import { sessions, users } from "@gmacko/db/schema/auth";

import {
  Sessions,
  SessionExpiredError,
  layerSessions,
} from "../sessions.js";

type TestCtx = Awaited<ReturnType<typeof createTestDb>>;

const VALID_TOKEN = "tok_valid_abc123";
const EXPIRED_TOKEN = "tok_expired_xyz789";
const USER_ID = "user_abc123";
const USER_EMAIL = "test@example.com";

let ctx: TestCtx;
let authLayer: Layer.Layer<Sessions>;

beforeEach(async () => {
  ctx = await createTestDb();

  // Seed: one user, one valid session (+1h), one expired session (-1h).
  const now = Date.now();
  await ctx.db.insert(users).values({
    id: USER_ID,
    name: "Test User",
    email: USER_EMAIL,
  });
  await ctx.db.insert(sessions).values([
    {
      id: "sess_valid",
      userId: USER_ID,
      token: VALID_TOKEN,
      expiresAt: new Date(now + 60 * 60 * 1000),
    },
    {
      id: "sess_expired",
      userId: USER_ID,
      token: EXPIRED_TOKEN,
      expiresAt: new Date(now - 60 * 60 * 1000),
    },
  ]);

  authLayer = Layer.provide(layerSessions, layerGmackoDb(ctx.db));
});

afterEach(async () => {
  await ctx.teardown();
});

describe("@gmacko/auth Sessions service", () => {
  it.effect("validateToken rejects unknown tokens with SessionExpiredError", () =>
    Effect.gen(function* () {
      const svc = yield* Sessions.asEffect();
      const caught = yield* svc.validateToken("unknown_token").pipe(
        Effect.catchTag("SessionExpiredError", (err) => Effect.succeed(err)),
      );
      expect(caught).toBeInstanceOf(SessionExpiredError);
    }).pipe(Effect.provide(authLayer)),
  );

  it.effect("validateToken returns userId + email for a valid token", () =>
    Effect.gen(function* () {
      const svc = yield* Sessions.asEffect();
      const result = yield* svc.validateToken(VALID_TOKEN);
      expect(result.userId).toBe(USER_ID);
      expect(result.email).toBe(USER_EMAIL);
    }).pipe(Effect.provide(authLayer)),
  );

  it.effect("validateToken rejects expired tokens with SessionExpiredError", () =>
    Effect.gen(function* () {
      const svc = yield* Sessions.asEffect();
      const caught = yield* svc.validateToken(EXPIRED_TOKEN).pipe(
        Effect.catchTag("SessionExpiredError", (err) => Effect.succeed(err)),
      );
      expect(caught).toBeInstanceOf(SessionExpiredError);
    }).pipe(Effect.provide(authLayer)),
  );

  it.effect("validateBearer returns null for missing header (no error)", () =>
    Effect.gen(function* () {
      const svc = yield* Sessions.asEffect();
      const result = yield* svc.validateBearer(null);
      expect(result).toBeNull();
    }).pipe(Effect.provide(authLayer)),
  );

  it.effect("validateBearer resolves a valid Bearer header", () =>
    Effect.gen(function* () {
      const svc = yield* Sessions.asEffect();
      const result = yield* svc.validateBearer(`Bearer ${VALID_TOKEN}`);
      expect(result).not.toBeNull();
      expect(result?.userId).toBe(USER_ID);
      expect(result?.email).toBe(USER_EMAIL);
    }).pipe(Effect.provide(authLayer)),
  );

  it.effect("validateBearer returns null when the Bearer value is whitespace only", () =>
    Effect.gen(function* () {
      const svc = yield* Sessions.asEffect();
      const result = yield* svc.validateBearer("Bearer   ");
      expect(result).toBeNull();
    }).pipe(Effect.provide(authLayer)),
  );

  it.effect("validateBearer returns null for non-Bearer schemes", () =>
    Effect.gen(function* () {
      const svc = yield* Sessions.asEffect();
      const result = yield* svc.validateBearer("Basic xyz");
      expect(result).toBeNull();
    }).pipe(Effect.provide(authLayer)),
  );
});
