/**
 * The six `secrets.*` procedures are gmacko-only and unimplemented in Bob.
 * They failed with `BobNotFoundError({entity:"secret", id:"not-implemented"})`,
 * but none of the Secrets Rpcs declare that error, so it could not be encoded
 * and the client got:
 *
 *   Expected UnauthorizedError | TenantNotSelectedError,
 *   got BobNotFoundError({"entity":"secret","id":"not-implemented"})
 *
 * — a schema mismatch instead of "this is not implemented". A defect is not
 * subject to the declared error channel, so the message survives.
 */
import { describe, expect, it, vi } from "vitest";
import { Cause, Effect, Exit } from "effect";

vi.mock("@bob/db/client", () => ({ db: {} }));

import { makeSecretsHandlers } from "../rpc-layers/secrets.js";

const ctx = { db: {}, userId: "u1", tenantId: undefined } as never;

const STUBS = [
  "secrets.create",
  "secrets.list",
  "secrets.getEnvelope",
  "secrets.decryptForUse",
  "secrets.markUsed",
] as const;

describe("unimplemented secrets stubs", () => {
  const handlers = makeSecretsHandlers(ctx) as Record<
    string,
    (input: unknown) => Effect.Effect<unknown, unknown, unknown>
  >;

  for (const tag of STUBS) {
    it(`${tag} says it is not implemented instead of failing to encode`, async () => {
      const exit = await Effect.runPromiseExit(
        handlers[tag]!({ payload: undefined }) as Effect.Effect<unknown, never, never>,
      );

      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) {
        const die = exit.cause.reasons.find((r) => Cause.isDieReason(r));
        expect(die).toBeDefined();
        expect(String((die as { defect?: unknown }).defect)).toContain("not implemented");
        expect(String((die as { defect?: unknown }).defect)).toContain(tag);
      }
    });
  }
});
