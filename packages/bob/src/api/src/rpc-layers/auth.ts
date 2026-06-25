/**
 * Aggregate layer that maps handler factory outputs to AuthRpc contract
 * names (11 procedures).
 *
 * Imports the auth handler factory, instantiates it with a HandlerContext,
 * and wires each factory key to the corresponding contract procedure name
 * expected by AuthRpc.toLayer().
 *
 * Nine gmacko-only auth RPCs (whoAmI, listMemberships, resolveTenant,
 * issueApiKey, listApiKeys, revokeApiKey, startDeviceFlow, pollDeviceCode,
 * approveDeviceCode) have no Bob equivalent and are stubbed with
 * BobNotFoundError.
 *
 * Phase 7B-4D-delta Task 3.
 */
import { Effect } from "effect";
import type { HandlerContext } from "../handlers/context.js";
import { AuthRpc } from "@gmacko/core/contracts/groups/auth";
import { BobNotFoundError } from "@gmacko/bob/contracts";
import { makeAuthRpcHandlers } from "../rpc-handlers/auth.js";

/**
 * Returns the raw handler mapping object for AuthRpc (11 entries).
 * Can be used standalone with `liftHandlers` in the server, or called
 * by `makeAuthLayer` which wraps the result in `AuthRpc.toLayer()`.
 */
export const makeAuthHandlers = (ctx: HandlerContext) => {
  const au = makeAuthRpcHandlers(ctx);

  return {
    // --- Stubs (9) — gmacko-only auth, no Bob equivalent ---
    "auth.whoAmI": () =>
      Effect.fail(
        new BobNotFoundError({ entity: "auth", id: "not-implemented" }),
      ),
    "auth.listMemberships": () =>
      Effect.fail(
        new BobNotFoundError({ entity: "auth", id: "not-implemented" }),
      ),
    "auth.resolveTenant": () =>
      Effect.fail(
        new BobNotFoundError({ entity: "auth", id: "not-implemented" }),
      ),
    "auth.issueApiKey": () =>
      Effect.fail(
        new BobNotFoundError({ entity: "auth", id: "not-implemented" }),
      ),
    "auth.listApiKeys": () =>
      Effect.fail(
        new BobNotFoundError({ entity: "auth", id: "not-implemented" }),
      ),
    "auth.revokeApiKey": () =>
      Effect.fail(
        new BobNotFoundError({ entity: "auth", id: "not-implemented" }),
      ),
    "auth.startDeviceFlow": () =>
      Effect.fail(
        new BobNotFoundError({ entity: "auth", id: "not-implemented" }),
      ),
    "auth.pollDeviceCode": () =>
      Effect.fail(
        new BobNotFoundError({ entity: "auth", id: "not-implemented" }),
      ),
    "auth.approveDeviceCode": () =>
      Effect.fail(
        new BobNotFoundError({ entity: "auth", id: "not-implemented" }),
      ),

    // --- Auth (2) — auth.* → auth.* (direct match) ---
    "auth.getSession": au["auth.getSession"],
    "auth.getSecretMessage": au["auth.getSecretMessage"],
  } as const;
};

export const makeAuthLayer = (ctx: HandlerContext) =>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- stubbed handlers narrow the contract error channel (BobNotFoundError vs never); mirrors rpc-server.ts established pattern
  AuthRpc.toLayer(makeAuthHandlers(ctx) as any);
