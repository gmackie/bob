import { afterEach, beforeEach, describe, expect, it as vitestIt } from "vitest";
import { it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import { createTestDb } from "@gmacko/core/db/testing";
import { GmackoDb, layerGmackoDb } from "@gmacko/core/db";
import { sessions, users } from "@gmacko/core/db/schema/auth";

import { layerBetterAuth } from "../better-auth.js";
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

// Minimal better-auth stub: the bearer/token tests don't exercise the
// cookie/signature path that goes through `auth.api.getSession`, so a stub
// returning `null` is enough to satisfy `BetterAuth`'s requirement.
const fakeAuth = {
  api: { getSession: async () => null },
} as unknown as Parameters<typeof layerBetterAuth>[0];

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

  authLayer = Layer.provide(
    layerSessions,
    Layer.mergeAll(layerGmackoDb(ctx.db), layerBetterAuth(fakeAuth)),
  );
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

describe("Sessions.validateRequest (signature-aware)", () => {
  // `layerSessions` requires `GmackoDb` (used by validateToken) even though
  // `validateRequest` itself doesn't touch the DB. Provide a stub so the
  // layer constructs cleanly; the impl never reads `db` on this path.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const stubDbLayer = Layer.succeed(GmackoDb)({} as any);

  vitestIt("delegates to betterAuth.api.getSession and returns userId+email when valid", async () => {
    const fakeAuth = {
      api: {
        getSession: async (_input: { headers: Headers }) => ({
          session: { userId: "user_123", token: "tok" },
          user: { id: "user_123", email: "alice@example.test" },
        }),
      },
    } as unknown as Parameters<typeof layerBetterAuth>[0];

    const program = Effect.gen(function* () {
      const sessions = yield* Sessions.asEffect();
      return yield* sessions.validateRequest(new Headers());
    }).pipe(
      Effect.provide(
        Layer.provide(
          layerSessions,
          Layer.mergeAll(layerBetterAuth(fakeAuth), stubDbLayer),
        ),
      ),
    );

    const result = await Effect.runPromise(program);
    expect(result).toEqual({ userId: "user_123", email: "alice@example.test" });
  });

  vitestIt("fails with SessionExpiredError when better-auth returns null", async () => {
    const fakeAuth = {
      api: { getSession: async () => null },
    } as unknown as Parameters<typeof layerBetterAuth>[0];
    const program = Effect.gen(function* () {
      const sessions = yield* Sessions.asEffect();
      return yield* sessions.validateRequest(new Headers()).pipe(
        Effect.catchTag("SessionExpiredError", (err) => Effect.succeed(err)),
      );
    }).pipe(
      Effect.provide(
        Layer.provide(
          layerSessions,
          Layer.mergeAll(layerBetterAuth(fakeAuth), stubDbLayer),
        ),
      ),
    );
    const caught = await Effect.runPromise(program);
    expect(caught).toBeInstanceOf(SessionExpiredError);
  });
});
