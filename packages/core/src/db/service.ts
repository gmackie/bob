// Effect service tag + layer for the drizzle db client.
//
// Services that need to read/write the database depend on `GmackoDb` and let
// the composition root decide which driver (PGlite / postgres-js) provides it.
// Use `layerGmackoDb(db)` to hoist a pre-built drizzle instance into a Layer.
import { Layer, ServiceMap } from "effect";
import type { getDb } from "./client.js";

export type Db = Awaited<ReturnType<typeof getDb>>;

export class GmackoDb extends ServiceMap.Service<GmackoDb, Db>()(
  "@gmacko/db/GmackoDb",
) {}

export const layerGmackoDb = (db: Db): Layer.Layer<GmackoDb> =>
  Layer.succeed(GmackoDb)(db);
