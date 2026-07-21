/**
 * Aggregate layer that maps handler factory outputs to SecretsRpc contract
 * names (14 procedures).
 *
 * Imports the secrets handler factory, instantiates it with a HandlerContext,
 * and wires each factory key to the corresponding contract procedure name
 * expected by SecretsRpc.toLayer().
 *
 * Six gmacko-only tenant-scoped secret RPCs (create, list, getEnvelope,
 * decryptForUse, markUsed, delete) have no Bob equivalent and are stubbed
 * with BobNotFoundError.
 *
 * Phase 7B-4D-delta Task 3.
 */
import { Effect } from "effect";
import type { HandlerContext } from "../handlers/context.js";
import { SecretsRpc } from "@gmacko/core/contracts/groups/secrets";
import { BobNotFoundError } from "@gmacko/bob/contracts";
import { makeSecretsRpcHandlers } from "../rpc-handlers/secrets.js";

/**
 * Returns the raw handler mapping object for SecretsRpc (14 entries).
 * Can be used standalone with `liftHandlers` in the server, or called
 * by `makeSecretsLayer` which wraps the result in `SecretsRpc.toLayer()`.
 */
export const makeSecretsHandlers = (ctx: HandlerContext) => {
  const sec = makeSecretsRpcHandlers(ctx);

  return {
    // --- Stubs (6) — gmacko-only tenant-scoped secrets, no Bob equivalent ---
    "secrets.create": () =>
      Effect.fail(
        new BobNotFoundError({ entity: "secret", id: "not-implemented" }),
      ),
    "secrets.list": () =>
      Effect.fail(
        new BobNotFoundError({ entity: "secret", id: "not-implemented" }),
      ),
    "secrets.getEnvelope": () =>
      Effect.fail(
        new BobNotFoundError({ entity: "secret", id: "not-implemented" }),
      ),
    "secrets.decryptForUse": () =>
      Effect.fail(
        new BobNotFoundError({ entity: "secret", id: "not-implemented" }),
      ),
    "secrets.markUsed": () =>
      Effect.fail(
        new BobNotFoundError({ entity: "secret", id: "not-implemented" }),
      ),
    "secrets.delete": () =>
      Effect.fail(
        new BobNotFoundError({ entity: "secret", id: "not-implemented" }),
      ),

    // --- Session Secrets (8) — secrets.* → secrets.session.* ---
    "secrets.session.getManifest":
      sec["secrets.getSessionSecretManifest"],
    "secrets.session.getForExecution":
      sec["secrets.getSessionSecretForExecution"],
    "secrets.session.create": sec["secrets.createSessionSecret"],
    "secrets.session.list": sec["secrets.listSessionSecrets"],
    "secrets.session.delete": sec["secrets.deleteSessionSecret"],
    "secrets.session.markUsed": sec["secrets.markSecretUsed"],
    "secrets.session.upsertDeployBinding":
      sec["secrets.upsertProjectDeployBinding"],
    "secrets.session.promote": sec["secrets.promoteSessionSecret"],
  } as const;
};

export const makeSecretsLayer = (ctx: HandlerContext) =>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- stubbed handlers narrow the contract error channel (BobNotFoundError vs never); mirrors rpc-server.ts established pattern
  SecretsRpc.toLayer(makeSecretsHandlers(ctx) as any);
