// Effect service for validating better-auth session tokens against the
// `sessions` + `users` tables. Pure drizzle — does not touch better-auth's
// `api.getSession` helper because those RPC-style calls are request-scoped
// and we want a cheap token lookup usable anywhere (bearer auth, middleware,
// background jobs).
//
// NOTE: not exported from the package barrel yet — Task 17 handles the
// public surface.
import { and, eq, gt } from "drizzle-orm";
import { Effect, Layer, Schema, ServiceMap } from "effect";

import { GmackoDb } from "@gmacko/db";
import {
  sessions as sessionsTable,
  users as usersTable,
} from "@gmacko/db/schema/auth";
import type { UserId } from "@gmacko/validators";

export class SessionExpiredError extends Schema.TaggedErrorClass<SessionExpiredError>()(
  "SessionExpiredError",
  { message: Schema.String },
) {}

export interface SessionValidationResult {
  readonly userId: UserId;
  readonly email: string;
}

export interface SessionsShape {
  readonly validateToken: (
    token: string,
  ) => Effect.Effect<SessionValidationResult, SessionExpiredError>;
  readonly validateBearer: (
    headerValue: string | null | undefined,
  ) => Effect.Effect<SessionValidationResult | null, SessionExpiredError>;
}

export class Sessions extends ServiceMap.Service<Sessions, SessionsShape>()(
  "@gmacko/auth/Sessions",
) {}

export const layerSessions: Layer.Layer<Sessions, never, GmackoDb> = Layer.effect(
  Sessions,
)(
  Effect.gen(function* () {
    const db = yield* GmackoDb;

    const validateToken: SessionsShape["validateToken"] = (token) =>
      Effect.gen(function* () {
        if (!token) {
          return yield* Effect.fail(
            new SessionExpiredError({ message: "Empty token" }),
          );
        }
        // drizzle's select returns an array; an empty array means no row
        // matched the (token, expiresAt > now) predicate. We do not rely on
        // thrown errors for "not found".
        const rows = yield* Effect.promise(() =>
          db
            .select({
              userId: sessionsTable.userId,
              email: usersTable.email,
              expiresAt: sessionsTable.expiresAt,
            })
            .from(sessionsTable)
            .innerJoin(usersTable, eq(usersTable.id, sessionsTable.userId))
            .where(
              and(
                eq(sessionsTable.token, token),
                gt(sessionsTable.expiresAt, new Date()),
              ),
            )
            .limit(1),
        );
        const row = rows[0];
        if (!row) {
          return yield* Effect.fail(
            new SessionExpiredError({
              message: "Session not found or expired",
            }),
          );
        }
        return {
          // The row came from our own sessions table and was inserted by
          // better-auth, which enforces its own id shape. A strict
          // Schema.decodeUnknownEffect(UserId) here is possible but buys little;
          // we keep the cast narrow and branded.
          userId: row.userId as UserId,
          email: row.email,
        };
      });

    const validateBearer: SessionsShape["validateBearer"] = (headerValue) =>
      Effect.gen(function* () {
        if (!headerValue) return null;
        const trimmed = headerValue.trim();
        if (!trimmed.toLowerCase().startsWith("bearer ")) return null;
        const token = trimmed.slice(7).trim();
        if (!token) return null;
        return yield* validateToken(token);
      });

    return { validateToken, validateBearer };
  }),
);
