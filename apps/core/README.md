# @gmacko/core-web — gmacko reference web app

Next.js 16 (app router) reference app for the gmacko stack. Coexists with OODA's existing pages (capture, graph, wiki, explore) at `/`. New gmacko-shared routes:

- `/login` — sign-in (email/password + GitHub OAuth + device-flow CTA)
- `/dashboard` — authenticated landing
- `/projects` — project CRUD via `@gmacko/client`
- `/agent` — start agent session + stream events
- `/secrets` — secret CRUD

## Setup

1. `pnpm install` at the repo root.
2. `cp apps/core/.env.example apps/core/.env.local` and fill in:
   - `BETTER_AUTH_SECRET` — random 32+ char string for session cookie signing.
   - `GMACKO_SECRET_ENCRYPTION_KEY` — random 32+ char string for `@gmacko/secrets` envelope encryption.
   - `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` — GitHub OAuth app credentials.
   - `ANTHROPIC_API_KEY` — for the Claude Code CLI agent adapter (or set `GMACKO_AGENT_ADAPTER=mock` to skip).
3. `pnpm --filter @gmacko/core-web dev` — server runs at http://localhost:3000.

## Environment variables

See `.env.example` for the full list. Required vars boot-time-fail-fast via `@gmacko/config`'s schema validation in `src/server/env.ts`.

## Architecture

- `src/server/env.ts` — Schema-validated env loader. Required vars (`BETTER_AUTH_SECRET`, `GMACKO_SECRET_ENCRYPTION_KEY`) fail at module load if absent.
- `src/server/layers.ts` — composes the gmacko service Layers (auth, projects, secrets, agent, realtime). Single source of truth for the server-side runtime. Holds the singleton PGlite handle + drizzle instance + better-auth instance.
- `src/server/handlers/` — real RPC handlers backed by service calls. Replaces the `@gmacko/contracts/stubs/*` mocks at runtime. Each handler invokes the corresponding service via `Effect.provide` of the composed runtime layer.
- `src/app/api/rpc/route.ts` — mounts the merged `RpcGroup` (Auth + Projects + Secrets + Agent) at `/api/rpc` via `RpcServer.layerHttp` + `RpcSerialization.layerNdjson` for chunked streaming.
- `src/app/api/auth/[...all]/route.ts` — better-auth Next.js route handler. Re-exports the better-auth instance's GET/POST handlers per the official Next.js convention.
- `src/app/layout.tsx` — wraps everything in `<GmackoAppProviders>` from `@gmacko/app-shell`. RPC client points at `/api/rpc` (relative URL — works in dev + prod).

### Build system notes

The webpack config in `next.config.ts` carries two non-default knobs that are load-bearing for builds against this monorepo:

- **`resolve.extensionAlias`** (and the matching Turbopack `resolveAlias`) — workspace packages (`@gmacko/auth`, `@gmacko/agent`, …) follow the `moduleResolution: "bundler"` convention and write intra-package imports with a `.js` extension that on disk is a `.ts` file. The alias map remaps `*.js` → `*.ts` / `*.tsx` / `*.js`.
- **Client-bundle Node-built-in stubs** — `@gmacko/auth` / `@gmacko/agent` / `@gmacko/db` services import `node:fs`, `node:path`, `node:url`, `node:crypto`, `node:child_process`, and (transitively) `perf_hooks` at module load. The client bundle tree-walks through these via `@gmacko/contracts`'s tagged-error classes → `@gmacko/client` → `@gmacko/app-shell`'s `RpcClientProvider`, even though no client code actually calls those services at runtime. The webpack callback in `next.config.ts`:
  1. Sets `resolve.fallback` to `false` for every relevant Node built-in (and for `@electric-sql/pglite` / `postgres` / `pg`) on the client bundle.
  2. Registers a `NormalModuleReplacementPlugin` that strips the `node:` scheme prefix from module specifiers — webpack's `UnhandledSchemeError` fires before `resolve.fallback` consults its map for `node:`-prefixed names.
- **`serverExternalPackages`** — `@electric-sql/pglite`, `postgres`, `pg`, `drizzle-orm` are loaded via Node's native `require` at runtime rather than bundled into the SSR build.
- **`@gmacko/db/migrate` subpath** — `@gmacko/db`'s root barrel deliberately does NOT re-export `runMigrations` / `migrate`; consumers import them via the dedicated `@gmacko/db/migrate` subpath. `migrate.ts` pulls in `drizzle-orm/pglite/migrator` (which has top-level `node:fs`/`node:path`/`node:url` imports) and webpack's tree-shaking does not strip them from a transpiled root barrel that's reached transitively via the contracts chain.

### Known issues

- `next build` (default Turbopack) currently fails to resolve subpath imports inside workspace packages (e.g. `@gmacko/contracts/groups/agent.ts → "../schemas/agent.js"`) despite the `turbopack.resolveAlias` map. Use `next build --webpack` for production builds.
- `next build --webpack` compiles successfully but TypeScript checking surfaces two pre-existing errors in legacy OODA pages:
  - `src/app/graph/page.tsx:60` — readonly array variance.
  - `src/components/voice-input.tsx:32-33` — possibly-undefined access.
  Neither blocks `next dev`. Fixing them is out of scope for phase 6K (the related OODA refactor lives in a future phase).

## Tests

- `pnpm --filter @gmacko/core-web test` — runs the full vitest suite.
- `pnpm --filter @gmacko/core-web test:smoke` — spawns `next dev --webpack`, hits `/api/rpc` end-to-end, asserts the wiring holds. Uses `GMACKO_AGENT_ADAPTER=mock` so it doesn't shell out to `claude`.

## Deferred for a future phase

- Real `runner.*` handlers + UI.
- Standalone transcript viewer page.
- Production deploy config (Postgres URL, connection pooling).
- Full Playwright matrix for visual regression + a11y.
- `chat_conversations.projectId` FK column.
- `session_secret_usages.sessionId → chat_conversations.id` FK promotion.
- Turbopack production build parity (the workspace `.js → .ts` alias is honored in dev but not in `next build`).
- Cleanup of pre-existing OODA TypeScript errors so `next build` runs to completion without manual TS overrides.
