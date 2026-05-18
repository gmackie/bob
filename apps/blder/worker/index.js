/**
 * Cloudflare Worker entry for blder.bot (platform app)
 *
 * Wraps vinext's app-router-entry, binds Hyperdrive to DATABASE_URL.
 */
import * as Sentry from "@sentry/cloudflare";

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

export default Sentry.withSentry(
  (env) => ({
    dsn: env.SENTRY_DSN,
    environment: env.FG_STAGE ?? "production",
    tracesSampleRate: 0.1,
  }),
  {
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

      try {
        const response = await handler.default.fetch(request);
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
  },
);
