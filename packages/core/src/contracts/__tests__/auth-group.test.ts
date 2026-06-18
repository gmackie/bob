// Tests for the Auth RPC contract group + stub handlers.
//
// Why these three cases:
//   1. RpcGroup composition — proves all 9 procedures wired up by tag. Drift
//      from renames or missing-from-group mistakes surface here first.
//   2. Stub handler determinism — proves the stub layer actually invokes the
//      handlers we defined and that the returned mock data round-trips
//      through the declared success Schema (decode matches shape + types).
//      Uses the in-process `RpcTest.makeClient` path so we don't stand up
//      HTTP transport just to exercise the handler layer.
//   3. Error-channel shape — proves the typed error declared on
//      `auth.revokeApiKey` (`InvalidApiKeyError`) is actually surfaced via
//      the RPC error channel when the stub fails. Catches drift if the error
//      schema ever gets dropped from `Rpc.make`.
import { describe, expect, it } from "vitest";
import { Effect, Schema } from "effect";
import { RpcTest } from "effect/unstable/rpc";

import { InvalidApiKeyError } from "@gmacko/core/auth/errors";

import { AuthRpc } from "../groups/auth.js";
import { stubAuthHandlers } from "../stubs/auth.js";
import { CurrentUserSchema, MembershipSchema } from "../schemas/auth.js";

const EXPECTED_TAGS = [
  "auth.whoAmI",
  "auth.listMemberships",
  "auth.resolveTenant",
  "auth.issueApiKey",
  "auth.listApiKeys",
  "auth.revokeApiKey",
  "auth.startDeviceFlow",
  "auth.pollDeviceCode",
  "auth.approveDeviceCode",
  // 7B-4B Task 11 — Bob auth
  "auth.getSession",
  "auth.getSecretMessage",
] as const;

describe("@gmacko/contracts AuthRpc group", () => {
  it("declares all 11 expected procedure tags", () => {
    const tags = Array.from(AuthRpc.requests.keys()).sort();
    expect(tags).toEqual([...EXPECTED_TAGS].sort());
    expect(AuthRpc.requests.size).toBe(11);
  });

  it("stub handlers return deterministic mock data that round-trips through the success schemas", async () => {
    const program = Effect.gen(function* () {
      const client = yield* RpcTest.makeClient(AuthRpc);

      const whoAmIResult = yield* client["auth.whoAmI"]();
      // Decode via schema to prove shape conformity, not just structural equality.
      const decodedWhoAmI = Schema.decodeUnknownSync(CurrentUserSchema)(whoAmIResult);
      expect(decodedWhoAmI).toEqual({
        userId: "user_stub_abc",
        tenantId: "00000000-0000-0000-0000-000000000001",
        email: "stub@example.com",
        role: "owner",
      });

      const memberships = yield* client["auth.listMemberships"]();
      expect(memberships).toHaveLength(1);
      const decodedMembership = Schema.decodeUnknownSync(MembershipSchema)(
        memberships[0],
      );
      expect(decodedMembership).toEqual({
        tenantId: "00000000-0000-0000-0000-000000000001",
        role: "owner",
      });

      const deviceFlow = yield* client["auth.startDeviceFlow"]();
      expect(deviceFlow.deviceCode).toBe("stub_device_code_abc");
      expect(deviceFlow.userCode).toBe("WXYZ-1234");
      expect(deviceFlow.verificationUri).toBe("https://stub.example/device");
    });

    await Effect.runPromise(
      program.pipe(Effect.provide(stubAuthHandlers), Effect.scoped),
    );
  });

  it("auth.revokeApiKey stub surfaces InvalidApiKeyError on unknown id via the RPC error channel", async () => {
    const program = Effect.gen(function* () {
      const client = yield* RpcTest.makeClient(AuthRpc);
      const caught = yield* Effect.flip(
        client["auth.revokeApiKey"]({ apiKeyId: "does_not_exist" }),
      );
      expect(caught).toBeInstanceOf(InvalidApiKeyError);
    });

    await Effect.runPromise(
      program.pipe(Effect.provide(stubAuthHandlers), Effect.scoped),
    );
  });
});
