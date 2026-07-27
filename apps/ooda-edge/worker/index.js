/**
 * Cloudflare Worker entry for ooda.blder.bot
 *
 * Wraps vinext's app-router-entry, binds Hyperdrive to DATABASE_URL.
 */
import { runWithDb } from "../src/lib/db-client-lazy";

let appRouterEntryPromise = null;
const getAppRouterEntry = async () => {
  if (!appRouterEntryPromise) {
    appRouterEntryPromise = import("vinext/server/app-router-entry");
  }
  return appRouterEntryPromise;
};

function bindWorkerEnvToNodeEnv(env) {
  const envEntries = {
    NODE_ENV: "production",
    REQUIRE_AUTH: "true",
  };

  const hyperdriveCs = env?.HYPERDRIVE?.connectionString;
  if (hyperdriveCs) {
    envEntries.DATABASE_URL = hyperdriveCs;
    envEntries.DATABASE_HYPERDRIVE = "true";
  } else if (typeof env?.DATABASE_URL === "string") {
    envEntries.DATABASE_URL = env.DATABASE_URL;
  }

  for (const [key, value] of Object.entries(env || {})) {
    if (typeof value === "string") {
      if (key === "DATABASE_URL" && envEntries.DATABASE_URL) continue;
      envEntries[key] = value;
    }
  }

  if (typeof process !== "undefined" && process?.env) {
    Object.assign(process.env, envEntries);
  } else {
    Object.assign(globalThis, { process: { env: envEntries } });
  }

  if (!envEntries.DATABASE_URL) {
    console.error("DATABASE_URL is not configured. Set Hyperdrive binding or wrangler secret.");
  }

  return envEntries.DATABASE_URL;
}

export default {
  async fetch(request, env) {
    const databaseUrl = bindWorkerEnvToNodeEnv(env);
    const handler = await getAppRouterEntry();
    const url = new URL(request.url);

    if (!databaseUrl && url.pathname.startsWith("/api")) {
      return Response.json(
        { error: { code: "DATABASE_URL_MISSING", message: "Database not configured." } },
        { status: 503, headers: { "Cache-Control": "no-store" } },
      );
    }

    // Scope ONE DB client to this request (see src/lib/db-client-lazy.ts). Every
    // `db.*` access inside the handler — better-auth's getSession, tRPC context,
    // apiKey validation — reuses this single Hyperdrive connection instead of
    // opening a fresh one per property access.
    const isHyperdrive = Boolean(env?.HYPERDRIVE?.connectionString);

    try {
      const response = await runWithDb(databaseUrl, isHyperdrive, () =>
        handler.default.fetch(request),
      );
      return response;
    } catch (error) {
      console.error("Worker handler error:", {
        url: url.pathname,
        name: error?.name,
        message: error?.message,
        stack: error?.stack?.split('\n').slice(0, 5).join('\n'),
      });
      return Response.json(
        { error: error?.message || "Internal error" },
        { status: 500 },
      );
    }
  },
};
