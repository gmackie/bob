// Tests for the Bob auth procedures added to the Auth RPC group (7B-4B Task 11).
//
// Verifies:
//   1. AuthRpc now declares 11 procedure tags (9 original + 2 Bob).
//   2. `auth.getSession` stub returns a session-like object (not null).
//   3. `auth.getSecretMessage` stub returns the expected string.
import { describe, expect, it } from "vitest";
import { Effect } from "effect";
import { RpcTest } from "effect/unstable/rpc";

import { AuthRpc } from "../groups/auth.js";
import { stubAuthHandlers } from "../stubs/auth.js";

describe("@gmacko/contracts AuthRpc — Bob auth procedures (Task 11)", () => {
  it("declares all 11 expected procedure tags", () => {
    expect(AuthRpc.requests.size).toBe(11);
    const tags = Array.from(AuthRpc.requests.keys()).sort();
    expect(tags).toContain("auth.getSession");
    expect(tags).toContain("auth.getSecretMessage");
  });

  it("auth.getSession stub returns a session object", async () => {
    const program = Effect.gen(function* () {
      const client = yield* RpcTest.makeClient(AuthRpc);
      const session = yield* client["auth.getSession"]();
      // Stub returns an object (not null) with user + session sub-objects.
      expect(session).not.toBeNull();
      expect(session).toHaveProperty("user");
      expect(session).toHaveProperty("session");
    });

    await Effect.runPromise(
      program.pipe(Effect.provide(stubAuthHandlers), Effect.scoped),
    );
  });

  it("auth.getSecretMessage stub returns the expected string", async () => {
    const program = Effect.gen(function* () {
      const client = yield* RpcTest.makeClient(AuthRpc);
      const msg = yield* client["auth.getSecretMessage"]();
      expect(msg).toBe("you can see this secret message!");
    });

    await Effect.runPromise(
      program.pipe(Effect.provide(stubAuthHandlers), Effect.scoped),
    );
  });
});
