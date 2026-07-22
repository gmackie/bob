import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";

import * as schema from "./schema";

// On the Cloudflare Workers edge (ooda-edge) these are injected on globalThis,
// not process.env — mirror `apps/ooda-edge/src/lib/db-client-lazy.ts` so this
// shared client is Hyperdrive-correct there too. Missing the globalThis check
// left `isHyperdrive=false` on the edge, so postgres.js kept prepared
// statements enabled — which Hyperdrive's pooled mode rejects, surfacing as
// intermittent "Failed query" errors (e.g. the apiKey lookup in authedProcedure).
const databaseUrl =
  (globalThis as { DATABASE_URL?: string }).DATABASE_URL ??
  process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("Missing DATABASE_URL environment variable");
}

const isHyperdrive =
  (globalThis as { DATABASE_HYPERDRIVE?: string }).DATABASE_HYPERDRIVE ===
    "true" || process.env.DATABASE_HYPERDRIVE === "true";

const sql = postgres(databaseUrl, {
  ...(isHyperdrive ? { prepare: false, ssl: false, max: 1 } : {}),
});

export const db = drizzle({
  client: sql,
  schema,
  casing: "snake_case",
});
