import type { TenantId, UserId } from "@gmacko/core/validators";
import {
  API_KEY_PREFIXES,
  ApiKeys,
  AuthMiddleware,
  Sessions,
  Tenancy,
} from "@gmacko/core/auth";
import { resolveCurrentUser } from "@gmacko/core/auth/middleware";
import {
  isApiKeyLike,
  validateApiKey as validateApiKeyPlain,
} from "@gmacko/core/auth/validate-api-key";
import { GmackoDb } from "@gmacko/core/db";
import { CurrentUser } from "@gmacko/core/rpc/context";
import { UnauthorizedError } from "@gmacko/core/rpc/errors";
import { Effect, Layer } from "effect";
import { HttpServerRequest } from "effect/unstable/http";

/** Bob's existing keys are user-scoped and have no api_keys.tenant_id column.
 * Validate those keys against the shared columns, then resolve membership just
 * as for a signed-in user. Session authentication retains the core middleware.
 */
export const layerBobAuthMiddleware = Layer.effect(AuthMiddleware)(
  Effect.gen(function* () {
    const db = yield* GmackoDb;
    const sessions = yield* Sessions;
    const apiKeys = yield* ApiKeys;
    const tenancy = yield* Tenancy;
    return (effect) =>
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest;
        const authorization = request.headers.authorization;
        const token = authorization?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
        if (!isApiKeyLike(token, API_KEY_PREFIXES)) {
          const user = yield* resolveCurrentUser({
            headers: request.headers,
            cookies: request.cookies,
          }).pipe(
            Effect.provideService(Sessions, sessions),
            Effect.provideService(ApiKeys, apiKeys),
            Effect.provideService(Tenancy, tenancy),
          );
          return yield* Effect.provideService(effect, CurrentUser, user);
        }
        const validated = yield* Effect.promise(() =>
          validateApiKeyPlain(db, token, API_KEY_PREFIXES),
        );
        if (!validated.ok)
          return yield* Effect.fail(
            new UnauthorizedError({ message: "Invalid or expired API key" }),
          );
        const hint = request.headers["x-tenant-id"];
        const membership = yield* tenancy
          .resolveForUser(
            validated.value.userId as UserId,
            hint ? (hint as TenantId) : null,
          )
          .pipe(
            Effect.catchTag("NotAMemberError", () =>
              Effect.fail(
                new UnauthorizedError({
                  message: "Not a member of the requested tenant",
                }),
              ),
            ),
          );
        return yield* Effect.provideService(effect, CurrentUser, {
          userId: validated.value.userId as UserId,
          tenantId: membership.tenantId,
          role: membership.role,
          email: validated.value.email ?? "",
          gatewayToken: token,
        });
      });
  }),
);
