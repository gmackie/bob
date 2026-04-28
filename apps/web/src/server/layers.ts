import "server-only";
import { Layer } from "effect";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";

import * as schema from "@gmacko/core/db/schema";
import { layerGmackoDb } from "@gmacko/core/db";
// `runMigrations` is imported via the `./migrate` subpath rather than the
// root barrel — `migrate.ts` pulls in `drizzle-orm/pglite/migrator` and Node
// built-ins, which webpack can't bundle into the client SSR pass when the
// root barrel is transitively reached via the `@gmacko/contracts` tagged
// errors → `@gmacko/client` → `@gmacko/app-shell` chain.
import { runMigrations } from "@gmacko/core/db/migrate";
import {
  ApiKeys,
  AuthMiddleware,
  initAuth,
  layerApiKeys,
  layerAuthMiddleware,
  layerBetterAuth,
  layerDeviceCodes,
  layerRunnerSessions,
  layerSessions,
  layerTenancy,
  Sessions,
  Tenancy,
} from "@gmacko/core/auth";
import { layerProjects } from "@gmacko/core/projects";
import { layerSecrets } from "@gmacko/core/secrets";
import {
  claudeCodeAdapter,
  layerAgent,
  mockAdapter,
  type AgentEvent,
} from "@gmacko/agent";
import { layerRealtime, makeRealtimeChannelTag } from "@gmacko/realtime";

import { getServerEnv } from "./env.js";

// ---------------------------------------------------------------------------
// Singleton DB — survives module HMR in `next dev` and is reused across
// route invocations. PGlite is in-process WASM Postgres; constructing a new
// instance per request would be wasteful and would lose the schema cache.
// ---------------------------------------------------------------------------

declare global {
  // eslint-disable-next-line no-var
  var __gmacko_db_pglite: PGlite | undefined;
  // eslint-disable-next-line no-var
  var __gmacko_db: ReturnType<typeof drizzle<typeof schema>> | undefined;
  // eslint-disable-next-line no-var
  var __gmacko_db_migrated: boolean | undefined;
}

function getDb(): {
  pglite: PGlite;
  db: ReturnType<typeof drizzle<typeof schema>>;
} {
  if (!globalThis.__gmacko_db_pglite) {
    const dataDir =
      process.env.PGLITE_DATA_DIR ?? `${process.env.HOME}/.gmacko/data`;
    const pglite = new PGlite(dataDir);
    globalThis.__gmacko_db_pglite = pglite;
    globalThis.__gmacko_db = drizzle(pglite, { schema });
    globalThis.__gmacko_db_migrated = false;
  }
  return {
    pglite: globalThis.__gmacko_db_pglite,
    db: globalThis.__gmacko_db!,
  };
}

/**
 * Idempotent migrator. The PGlite migrator tracks applied migrations in
 * `__drizzle_migrations`, so this is safe to call on every request. We
 * gate behind a process-level boolean to skip the no-op DDL probe after
 * the first call.
 */
export async function ensureMigrated(): Promise<void> {
  if (globalThis.__gmacko_db_migrated) return;
  const { pglite } = getDb();
  await runMigrations(pglite);
  globalThis.__gmacko_db_migrated = true;
}

// ---------------------------------------------------------------------------
// Better-auth instance (one per process). Constructed at module load so the
// route handler at /api/auth/[...all] can re-export `authInstance.handler`
// directly per better-auth's Next.js convention.
// ---------------------------------------------------------------------------

const env = getServerEnv();
const { db } = getDb();

const baseUrl = env.PUBLIC_BASE_URL ?? "http://localhost:3000";

// Email + password provider toggle. Production wiring stays GitHub-OAuth +
// device-code only (provider stays off). The apps/web smoke test sets the
// env var so /sign-up/email + /sign-in/email become reachable.
const emailAndPasswordEnabled =
  env.GMACKO_BETTER_AUTH_EMAIL_PASSWORD === "true";
const emailAndPassword = emailAndPasswordEnabled
  ? {
      enabled: true,
      requireEmailVerification:
        env.GMACKO_BETTER_AUTH_REQUIRE_EMAIL_VERIFICATION !== "false",
    }
  : undefined;

export const authInstance = initAuth({
  db,
  // Pass the gmacko schema map so better-auth's drizzle adapter can resolve
  // tables by name. We use plural conventions (`users`, `sessions`, …)
  // whereas better-auth defaults to singular — `pluralizeTables: true` flips
  // the lookup. Without this, sign-up/sign-in returns 500 with
  // `[# Drizzle Adapter]: The model "user" was not found in the schema
  // object.` (only an issue when the email + password provider is on, since
  // GitHub OAuth callbacks are still 6L-deferred).
  schema: schema as unknown as Record<string, unknown>,
  pluralizeTables: true,
  baseUrl,
  productionUrl: baseUrl,
  secret: env.BETTER_AUTH_SECRET,
  githubClientId: env.GITHUB_CLIENT_ID ?? "",
  githubClientSecret: env.GITHUB_CLIENT_SECRET ?? "",
  ...(emailAndPassword ? { emailAndPassword } : {}),
});

// ---------------------------------------------------------------------------
// Per-process channel tag for agent events. Capturing the tag here (rather
// than per-handler) ensures every Layer that publishes/subscribes to agent
// events shares the same Service identity at the ServiceMap level.
// ---------------------------------------------------------------------------

export const AgentEventsChannel = makeRealtimeChannelTag<AgentEvent>(
  "@gmacko/web/AgentEventsChannel",
);

// ---------------------------------------------------------------------------
// Adapter selection. Mock for tests; claude-code-cli for dev/prod.
// ---------------------------------------------------------------------------

const adapter =
  env.GMACKO_AGENT_ADAPTER === "mock"
    ? mockAdapter({ events: [] })
    : claudeCodeAdapter();

// ---------------------------------------------------------------------------
// Composed runtime Layer.
//
// Composition pattern (Effect 4 Layer plumbing):
//   - `dbLayer` provides `GmackoDb` to every db-backed service.
//   - Each service Layer that requires `GmackoDb` is wrapped with
//     `Layer.provide(serviceLayer, dbLayer)` — this satisfies the dep so
//     the resulting Layer's requirement set narrows to `never`.
//   - `layerDeviceCodes()` requires `GmackoDb | ApiKeys`; we pre-feed it
//     a merged Layer that supplies both.
//   - `layerBetterAuth(instance)` and `layerRunnerSessions` have no deps,
//     so they merge in directly.
//   - `layerRealtime` selects a backend at construction time and likewise
//     has `never` requirements.
//   - `layerAuthMiddleware` requires `Sessions | ApiKeys | Tenancy`. It is
//     composed separately (`authMiddlewareLayer`) so route handlers can
//     `Layer.provide` it onto the merged RpcGroup at mount time.
// ---------------------------------------------------------------------------

const dbLayer = layerGmackoDb(db);

// Pre-built db-fed service layers. `Layer.provide(child, parent)` plumbs the
// parent's outputs into the child's requirements; the resulting Layer
// surfaces only the still-unsatisfied deps.
const sessionsLayer = Layer.provide(
  layerSessions,
  Layer.mergeAll(dbLayer, layerBetterAuth(authInstance)),
);
const apiKeysLayer = Layer.provide(layerApiKeys(), dbLayer);
const tenancyLayer = Layer.provide(layerTenancy, dbLayer);
const projectsLayer = Layer.provide(layerProjects, dbLayer);
const secretsLayer = Layer.provide(layerSecrets, dbLayer);
const agentLayer = Layer.provide(layerAgent(adapter), dbLayer);

// DeviceCodes requires GmackoDb + ApiKeys; provide both via a merged layer.
const deviceCodesLayer = Layer.provide(
  layerDeviceCodes(),
  Layer.mergeAll(dbLayer, apiKeysLayer),
);

export const runtimeLayer = Layer.mergeAll(
  // Re-expose `GmackoDb` so route handlers that bypass a service (e.g.
  // `agent.getTranscript` queries `chat_conversations` + `chat_messages`
  // directly until `AgentSession` grows a transcript reader) can access
  // the singleton drizzle handle without re-deriving the Layer.
  dbLayer,
  layerBetterAuth(authInstance),
  sessionsLayer,
  apiKeysLayer,
  tenancyLayer,
  deviceCodesLayer,
  projectsLayer,
  secretsLayer,
  agentLayer,
  layerRealtime(env.REALTIME_BACKEND ?? "memory", AgentEventsChannel),
  layerRunnerSessions,
);

// AuthMiddleware Layer — requires Sessions | ApiKeys | Tenancy. Built on top
// of those services so route handlers can compose `runtimeLayer` then plumb
// the middleware Layer above the merged RpcGroup at mount time. Kept
// separate from `runtimeLayer` because the middleware itself is consumed via
// `RpcGroup.middleware(AuthMiddleware)` — the Layer machinery in `RpcServer`
// resolves it from this Layer when the group's requirement-set asks for it.
export const authMiddlewareLayer = Layer.provide(
  layerAuthMiddleware,
  Layer.mergeAll(sessionsLayer, apiKeysLayer, tenancyLayer),
);

// Re-exports — handy for downstream handler modules that need to grab these
// service tags or the AuthMiddleware tag without re-importing from
// `@gmacko/auth`.
export {
  Sessions,
  ApiKeys,
  Tenancy,
  AuthMiddleware,
};
