import { describe, expect } from "vitest";
import { it } from "@effect/vitest";
import { Effect, Schema } from "effect";
import { TenantId, TenantMemberRole, UserId } from "@gmacko/core/validators";
import { CurrentUser, type CurrentUserShape } from "../context.js";
import { requireAuth } from "../middleware.js";
import { UnauthorizedError } from "../errors.js";

const decodeUser = Schema.decodeUnknownSync(UserId);
const decodeTenant = Schema.decodeUnknownSync(TenantId);
const decodeRole = Schema.decodeUnknownSync(TenantMemberRole);

describe("@gmacko/rpc requireAuth", () => {
  it.effect("passes through when a CurrentUser is provided with all fields", () =>
    Effect.gen(function* () {
      const user: CurrentUserShape = {
        userId: decodeUser("user_abc123"),
        tenantId: decodeTenant("550e8400-e29b-41d4-a716-446655440000"),
        email: "user@example.com",
        role: decodeRole("owner"),
      };

      const result = yield* requireAuth(Effect.succeed("ok")).pipe(
        Effect.provideService(CurrentUser, user),
      );
      expect(result).toBe("ok");
    }),
  );

  it.effect("fails with UnauthorizedError when tenantId is missing", () =>
    Effect.gen(function* () {
      const user = {
        userId: decodeUser("user_abc123"),
        tenantId: "" as unknown as CurrentUserShape["tenantId"],
        email: "user@example.com",
        role: decodeRole("member"),
      } satisfies CurrentUserShape;

      const caught: UnauthorizedError | "ok" = yield* requireAuth(
        Effect.succeed("ok" as const),
      ).pipe(
        Effect.provideService(CurrentUser, user),
        Effect.catchTag("UnauthorizedError", (err) => Effect.succeed(err)),
      );
      expect(caught).toBeInstanceOf(UnauthorizedError);
      expect(caught).not.toBe("ok");
    }),
  );
});
