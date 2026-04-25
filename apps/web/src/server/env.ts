import "server-only";
import { Effect, Schema } from "effect";

import { NodeEnv, RealtimeBackend, loadConfig } from "@gmacko/config";

// Server-only env schema. `loadConfig` returns an Effect that decodes
// `process.env` against this Schema; we run it synchronously at module
// load and cache the result. Boot-time fail-fast on missing required
// vars (BETTER_AUTH_SECRET, GMACKO_SECRET_ENCRYPTION_KEY).
//
// OAuth + Anthropic + ADAPTER selection are kept optional so test
// environments and `next build` (which evaluates module-top code) can
// boot without provisioning every secret. Production deployments are
// expected to set them all; the smoke test runs with mock adapters.
export const ServerEnv = Schema.Struct({
  NODE_ENV: Schema.optional(NodeEnv),
  // Crypto + auth (required — boot fails without them)
  GMACKO_SECRET_ENCRYPTION_KEY: Schema.String.pipe(
    Schema.check(Schema.isMinLength(32)),
  ),
  BETTER_AUTH_SECRET: Schema.String.pipe(Schema.check(Schema.isMinLength(16))),
  // OAuth (optional in dev — provider stays disabled if creds missing)
  GITHUB_CLIENT_ID: Schema.optional(Schema.String),
  GITHUB_CLIENT_SECRET: Schema.optional(Schema.String),
  // Anthropic (optional — only required when claude-code adapter actually runs)
  ANTHROPIC_API_KEY: Schema.optional(Schema.String),
  // Realtime backend selector — defaults to "memory" if absent
  REALTIME_BACKEND: Schema.optional(RealtimeBackend),
  // Agent adapter selector — "mock" for tests, "claude-code" otherwise
  GMACKO_AGENT_ADAPTER: Schema.optional(
    Schema.Literals(["claude-code", "mock"]),
  ),
  // Public URL used for OAuth redirects + better-auth baseURL
  PUBLIC_BASE_URL: Schema.optional(Schema.String),
  // PGlite data directory override (defaults to ~/.gmacko/data)
  PGLITE_DATA_DIR: Schema.optional(Schema.String),
  // Runner session HMAC sub-key (used by @gmacko/auth/runner-sessions). The
  // service derives a sub-key from `GMACKO_SECRET_ENCRYPTION_KEY` if not set,
  // so we don't surface it as a required field here.
});
export type ServerEnv = Schema.Schema.Type<typeof ServerEnv>;

let cached: ServerEnv | null = null;
export function getServerEnv(): ServerEnv {
  if (cached) return cached;
  cached = Effect.runSync(loadConfig(ServerEnv, process.env));
  return cached;
}
