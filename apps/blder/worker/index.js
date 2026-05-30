/**
 * Cloudflare Worker entry for blder.bot
 *
 * Wraps vinext's app-router-entry, binds Hyperdrive to DATABASE_URL,
 * and handles edge routing (auth redirects, image optimization).
 */
import { handleImageOptimization } from "vinext/server/image-optimization";

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

  // Hyperdrive binding → DATABASE_URL
  const hyperdriveCs = env?.HYPERDRIVE?.connectionString;
  if (hyperdriveCs) {
    envEntries.DATABASE_URL = hyperdriveCs;
    envEntries.DATABASE_HYPERDRIVE = "true";
  } else if (typeof env?.DATABASE_URL === "string") {
    envEntries.DATABASE_URL = env.DATABASE_URL;
  }

  // Copy all string env vars (secrets + vars from wrangler)
  for (const [key, value] of Object.entries(env || {})) {
    if (typeof value === "string") {
      if (key === "DATABASE_URL" && envEntries.DATABASE_URL) continue;
      envEntries[key] = value;
    }
  }

  // Bind to process.env
  if (typeof process !== "undefined" && process?.env) {
    Object.assign(process.env, envEntries);
  } else {
    Object.assign(globalThis, { process: { env: envEntries } });
  }

  if (!envEntries.DATABASE_URL) {
    console.error(
      "DATABASE_URL is not configured. Set Hyperdrive binding or wrangler secret.",
    );
  }

  return envEntries.DATABASE_URL;
}

function getClientIp(request) {
  const cfIp = request.headers.get("cf-connecting-ip")?.trim();
  if (cfIp) return cfIp;

  const forwardedFor = request.headers
    .get("x-forwarded-for")
    ?.split(",")[0]
    ?.trim();
  return forwardedFor || "unknown";
}

function rateLimitExceededResponse() {
  return Response.json(
    {
      error: {
        code: "RATE_LIMITED",
        message: "Too many authentication requests.",
      },
    },
    {
      status: 429,
      headers: {
        "Cache-Control": "no-store",
        "Retry-After": "60",
      },
    },
  );
}

export default {
  async fetch(request, env) {
    const databaseUrl = bindWorkerEnvToNodeEnv(env);
    const url = new URL(request.url);

    // Image optimization
    if (url.pathname === "/_vinext/image") {
      return handleImageOptimization(request, {
        fetchAsset: (path) =>
          env.ASSETS.fetch(new Request(new URL(path, request.url))),
        transformImage: async (body, { width, format, quality }) => {
          const result = await env.IMAGES.input(body)
            .transform(width > 0 ? { width } : {})
            .output({ format, quality });
          return result.response();
        },
      });
    }

    if (url.pathname === "/api/auth" || url.pathname.startsWith("/api/auth/")) {
      if (!env.AUTH_RATE_LIMITER) {
        return Response.json(
          {
            error: {
              code: "RATE_LIMITER_MISSING",
              message: "Authentication rate limiter is not configured.",
            },
          },
          { status: 503, headers: { "Cache-Control": "no-store" } },
        );
      }

      const { success } = await env.AUTH_RATE_LIMITER.limit({
        key: `auth:${getClientIp(request)}`,
      });

      if (!success) {
        return rateLimitExceededResponse();
      }
    }

    // Database not configured — return 503 for API routes
    if (!databaseUrl && url.pathname.startsWith("/api")) {
      return Response.json(
        {
          error: {
            code: "DATABASE_URL_MISSING",
            message: "Database not configured.",
          },
        },
        { status: 503, headers: { "Cache-Control": "no-store" } },
      );
    }

    try {
      const handler = await getAppRouterEntry();
      const response = await handler.default.fetch(request);
      return response;
    } catch (error) {
      console.error("Worker handler error:", {
        url: url.pathname,
        name: error?.name,
        message: error?.message,
        code: error?.code,
        stack: error?.stack?.split("\n").slice(0, 5).join("\n"),
      });
      return Response.json(
        {
          error: error?.message || "Internal error",
          stack: error?.stack?.split("\n").slice(0, 5),
        },
        { status: 500, headers: { "Content-Type": "application/json" } },
      );
    }
  },
};
