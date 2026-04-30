import "server-only";
import { Layer } from "effect";

import { layerGmackoDb } from "@gmacko/core/db";
import {
  layerBetterAuth,
  layerSessions,
  layerApiKeys,
  layerTenancy,
  layerAuthMiddleware,
} from "@gmacko/core/auth";

import { db } from "@bob/db/client";
import { authBundle } from "~/auth/server";

// ---------------------------------------------------------------------------
// Bob's Effect Layer stack — mirrors `apps/core/src/server/layers.ts` but
// uses Bob's `db` (PGlite/node-postgres via @bob/db/client) and Bob's
// `authBundle` (from createAuthRuntime). This Layer composition supplies the
// db-backed services that the Effect-RPC server mount needs:
//   - GmackoDb (from Bob's drizzle handle)
//   - Sessions (via BetterAuth + GmackoDb)
//   - ApiKeys (via GmackoDb)
//   - Tenancy (via GmackoDb)
// ---------------------------------------------------------------------------

// Bob's Db (NodePgDatabase<bobSchema>) differs from gmacko's Db type.
// Cast is safe — drizzle query API is compatible at runtime.
const dbLayer = layerGmackoDb(db as never);
const betterAuthLayer = layerBetterAuth(authBundle.authInstance);

const sessionsLayer = Layer.provide(
  layerSessions,
  Layer.mergeAll(dbLayer, betterAuthLayer),
);
const apiKeysLayer = Layer.provide(layerApiKeys(), dbLayer);
const tenancyLayer = Layer.provide(layerTenancy, dbLayer);

export const runtimeLayer = Layer.mergeAll(
  dbLayer,
  sessionsLayer,
  apiKeysLayer,
  tenancyLayer,
);

export const authMiddlewareLayer = Layer.provide(
  layerAuthMiddleware,
  Layer.mergeAll(sessionsLayer, apiKeysLayer, tenancyLayer),
);
