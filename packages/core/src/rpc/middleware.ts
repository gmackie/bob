import { Effect } from "effect";
import { UnauthorizedError } from "./errors.js";
import { CurrentUser } from "./context.js";

// Guard that requires an authenticated user in context.
// Handlers needing auth wrap their Effect with requireAuth.
export const requireAuth = <A, E, R>(
  eff: Effect.Effect<A, E, R>,
): Effect.Effect<A, E | UnauthorizedError, R | CurrentUser> =>
  Effect.gen(function* () {
    const user = yield* CurrentUser.asEffect();
    if (!user.userId || !user.tenantId) {
      return yield* Effect.fail(
        new UnauthorizedError({ message: "No authenticated user" }),
      );
    }
    return yield* eff;
  });
