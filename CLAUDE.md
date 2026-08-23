# Gmacko

Shared monorepo for gmacko (Effect-RPC + Next.js reference) and Bob (tRPC + CF + Vite). Will become the gmacko fork of t3code; OODA folds in.

## Architecture

Three package namespaces, six eventual apps + Bob's services + desktops.

### Packages

- `packages/core` — Shared infrastructure. Former 30 `@gmacko/*` packages now live here as subpaths: `auth`, `db`, `agent`, `contracts`, `ui`, `models`, `wiki`-adjacent infra, etc.
- `packages/ooda` — OODA research workstation. 16 subpath exports: `db`, `api`, `thread-model`, `thread-workspace`, `provenance`, `capability-registry`, `runner-protocol`, `source-connectors`, `imports`, `domain-packs`, `vault`, `buddy-tools`, `agent-adapters`, `wiki`, `ext`. Uses tRPC (not Effect-RPC) — conversion to Effect-RPC deferred to Phase 8C.
- `packages/bob` — Bob's source tree as nested workspace packages. 25 `@bob/*` packages (plus one unscoped `bob`) preserved unchanged for now; per-area rewriting happens in 7B-2..N. See `docs/plans/phase-7b/03-bob-copy-verification.md` for the full inventory.

### Apps

Reference (gmacko stack):
- `apps/core` — gmacko reference Next.js app, hosts the Effect-RPC route (formerly `apps/web`).
- `apps/mobile-core` — gmacko reference Expo app (formerly `apps/mobile`).
- `apps/desktop` — gmacko reference desktop (Electron).
- `apps/ooda` — OODA research workstation (Next.js 16, port 3001). Full web app with tRPC handler at `/api/trpc/`. Pages: threads, research, capture, health.
- `apps/ooda-runner` — OODA runner process. Long-lived Node process, registers with API, claims sessions, executes Codex/Claude adapters.
- `apps/ooda-cli` — OODA CLI tool. Thin wrapper around thread-workspace operations.

Bob (copied verbatim, runs unchanged):
- `apps/bob/` — Bob's main web app (Vite + CF Workers).
- `apps/mobile-bob/` — Bob mobile (Expo 55).
- `apps/desktop-bob/` — Bob desktop (Electron 40).
- `apps/bob-server/` — Bob's Node server.
- `apps/bob-ws-gateway/` — Bob's realtime gateway.
- `apps/bob-execution/` — Bob's execution runner.

Eventual 6-app target: `apps/{core,bob,ooda,mobile-core,mobile-bob,mobile-ooda}` plus the desktops and Bob's services.

### Tooling

- `tooling/typescript`, `tooling/tailwind` — gmacko shared configs.
- `tooling/bob-{typescript,tailwind,eslint,prettier,github}` — Bob's tooling, dirs renamed; package names preserved as `@bob/*`.

## Stack

Three stacks coexist until per-area migrations land:

- **Gmacko reference:** Effect 4.0.0-beta.43, Effect-RPC, Drizzle ORM, PGlite/PostgreSQL, Next.js 16, React 19, Expo 55, Tailwind CSS 4, NativeWind 5, CVA, Anthropic SDK.
- **Bob:** tRPC, better-auth, Pusher, Vite, CF Workers, Expo 55, Electron 40, Drizzle, React 19.
- **OODA:** tRPC v11.7, Drizzle ORM 0.45, Next.js 16, Vitest 4, Python/FastAPI sidecar (`packages/research-backend/`). Schema + runner convergence in Phase 8B; tRPC → Effect-RPC in Phase 8C.

## Themes

Set `data-theme` attribute: `"ooda"` (dark + gold — placeholder) or `"bob"` (amber + warm gray — per Bob's DESIGN.md: primary #D4850A, Satoshi + DM Sans, Industrial/utilitarian).

Themes will eventually be co-located in `@gmacko/core/ui` (locked decision).

## Development

```
cd apps/core && pnpm dev             # gmacko reference Next.js (port 3000, hosts RPC route)
cd apps/mobile-core && pnpm dev      # gmacko reference Expo
cd apps/desktop && pnpm dev          # gmacko reference Electron
cd apps/ooda && pnpm dev             # OODA Next.js app (port 3001)
cd apps/ooda-runner && pnpm dev      # OODA runner process
cd packages/research-backend && uv run uvicorn research_backend.main:app --reload --port 8000  # Python sidecar
cd apps/bob && pnpm dev              # Bob's main web app (Vite)
cd apps/bob-server && pnpm dev       # Bob's Node server
cd apps/mobile-bob && pnpm dev       # Bob mobile (Expo)
cd apps/desktop-bob && pnpm dev      # Bob desktop (Electron)
```

### Database drivers

- **Default (PGlite):** No setup needed — WASM Postgres runs in-process, data at `~/.gmacko/data`.
- **PostgreSQL:** Set `GMACKO_DB_DRIVER=postgres` and `DATABASE_URL=postgres://...`.

### Testing

Phase 7B-0+ verification command (keeps PGlite from flaking):

```
pnpm exec turbo run test --concurrency=1 -- --no-file-parallelism
```

## Key Patterns

- RPC contracts defined with Effect/Schema + `Rpc.make()`.
- Services use Effect `ServiceMap.Service` + Layer pattern.
- Web/mobile clients use typed fetch + React Query (no Effect runtime in browser).
- All UI components use CSS custom properties for theming.
- Bob's tRPC pattern coexists with Effect-RPC pending per-area migration.

## Bob coexistence (Phase 7B+)

Bob's source lives under `packages/bob/src/<pkg>/` as nested workspace packages. The `@bob/*` namespace (and one unscoped `bob`) is preserved unchanged so Bob can be rebuilt and run inside gmacko on its existing Vite + CF Workers + Expo + Electron stack with no source rewriting.

Per-area migrations onto gmacko's stack (auth, db, realtime, etc.) land incrementally in 7B-2..9. Until then, the two stacks run side-by-side.

The 6 pre-existing Bob test failures (`@bob/execution` taskExecutor + `@bob/api` cookies/featureBranch/work-items) are documented in `docs/plans/phase-7b/02-bob-probe.md` and are out of scope for 7B-1a.

## Product boundary (enforced)

Bob and OODA are two products in one repo. The boundary is a package wall, checked by `scripts/verify-product-boundary.test.mjs` in CI:

```
packages/ooda/**  must not import  @bob/*
packages/bob/**   must not import  @gmacko/ooda
apps/**           may import both — composition lives here
```

- `packages/ooda` owns deliberation, memory, provenance, proposals, research, vault, oracle.
- `packages/bob` owns work items, execution, runs, PRs, projects, ForgeGraph.
- `packages/core` owns shared infrastructure and no domain nouns from either side.

**There is no allowlist** — the correct number of exceptions is zero. If a leaf package needs the other side: move it to `@gmacko/core` if it is infrastructure (see `@gmacko/core/telemetry` and `@gmacko/core/skillfleet-bridge`), go through `@gmacko/ooda/contracts/v1` + `src/integrations/` if it is a cross-product call, or compose it in `apps/*`.

Durable or externally-visible action crosses via **proposals** — immutable payload digest, named owner, expiry, consequence, rollback, single-use approval. Workers get scratch capabilities, never durable writes.

Full rationale: `docs/architecture/product-boundary.md`.

The standalone `ooda` repo was archived 2026-08-23; OODA is developed here. Parity evidence: `docs/migrations/ooda-fold-parity.json`.

**`bob-cli` is not retired.** `apps/ooda-runner` replaced it as the *server-side* daemon, but `apps/desktop-bob` still cross-compiles and bundles the Go CLI (`scripts/build-daemon.mjs`, `electron-builder.yml`). Two daemons exist for two deployment shapes.

## Skill routing

When the user's request matches an available skill, invoke it via the Skill tool. When in doubt, invoke the skill.

Key routing rules:
- Product ideas/brainstorming → invoke /office-hours
- Strategy/scope → invoke /plan-ceo-review
- Architecture → invoke /plan-eng-review
- Design system/plan review → invoke /design-consultation or /plan-design-review
- Full review pipeline → invoke /autoplan
- Bugs/errors → invoke /investigate
- QA/testing site behavior → invoke /qa or /qa-only
- Code review/diff check → invoke /review
- Visual polish → invoke /design-review
- Ship/deploy/PR → invoke /ship or /land-and-deploy
- Save progress → invoke /context-save
- Resume context → invoke /context-restore
