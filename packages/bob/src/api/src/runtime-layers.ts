/**
 * Next-free builder for Bob's Effect runtime + auth-middleware layers (plan
 * Task 4c). Extracted from `apps/bob/src/server/layers.ts` so it can be used by
 * BOTH the blder web app AND the Node `bob-server` — the original file pulls in
 * `~/auth/server`, which imports `react` + `next/headers` and therefore can't
 * load in a plain Node process.
 *
 * The caller passes the drizzle `db` handle and a better-auth instance; this
 * module has no app-local or Next dependencies.
 */
import { Layer } from "effect";

import { layerGmackoDb } from "@gmacko/core/db";
import {
  layerBetterAuth,
  layerSessions,
  layerApiKeys,
  layerTenancy,
  layerAuthMiddleware,
} from "@gmacko/core/auth";

export interface BobRuntimeLayersInput {
  /** Bob's drizzle handle (NodePgDatabase<bobSchema> / PGlite). */
  readonly db: unknown;
  /** The better-auth instance (`authBundle.authInstance`). */
  readonly authInstance: Parameters<typeof layerBetterAuth>[0];
}

export interface BobRuntimeLayers {
  readonly runtimeLayer: Layer.Layer<any, any, any>;
  readonly authMiddlewareLayer: Layer.Layer<any, any, any>;
}

/**
 * Compose the db-backed service layers the Effect-RPC server needs:
 *   - GmackoDb (from Bob's drizzle handle)
 *   - Sessions (BetterAuth + GmackoDb)
 *   - ApiKeys / Tenancy (GmackoDb)
 * plus the AuthMiddleware layer used to inject `CurrentUser` per request.
 */
export function makeBobRuntimeLayers(
  input: BobRuntimeLayersInput,
): BobRuntimeLayers {
  // Bob's Db type differs from gmacko's; the cast is safe — drizzle's query
  // API is compatible at runtime.
  const dbLayer = layerGmackoDb(input.db as never);
  const betterAuthLayer = layerBetterAuth(input.authInstance);

  const sessionsLayer = Layer.provide(
    layerSessions,
    Layer.mergeAll(dbLayer, betterAuthLayer),
  );
  const apiKeysLayer = Layer.provide(layerApiKeys(), dbLayer);
  const tenancyLayer = Layer.provide(layerTenancy, dbLayer);

  const runtimeLayer = Layer.mergeAll(
    dbLayer,
    sessionsLayer,
    apiKeysLayer,
    tenancyLayer,
  );

  const authMiddlewareLayer = Layer.provide(
    layerAuthMiddleware,
    Layer.mergeAll(sessionsLayer, apiKeysLayer, tenancyLayer),
  );

  return { runtimeLayer, authMiddlewareLayer };
}
