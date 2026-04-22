# Phase 6: gmacko Core Finalization — Master Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Each sub-phase (6B–6L) has its own detailed plan doc that gets written when that sub-phase is picked up. This master doc contains the full detail for **6A (Scaffolding & Foundation)** inline, plus roadmap-level specs for the rest.

**Goal:** Finalize gmacko core so Bob can be migrated onto it. Add 23 core packages (auth, secrets, agent session primitive, runner protocol/base, realtime, app shells, theme mechanism + Bob reference theme). Hit the §7 success criteria in `docs/plans/2026-04-19-gmacko-core-finalization-design.md`.

**Architecture:** Effect-RPC canonical. Shared packages expose Effect RPC groups, Effect services, Effect/Schema contracts. Each product's app composes shell packages + product-specific features. Every RPC handler receives a `CurrentUser` context. Session primitive (agent) + runner protocol are transport-agnostic and persisted to shared DB tables owned by gmacko. SSE for server→client streaming; pluggable pubsub (in-memory / Redis / ws-gateway — no Pusher) for fan-out.

**Tech Stack:** Effect 4.0.0-beta.43, @effect/platform-node, @effect/unstable/rpc, Effect/Schema, better-auth, Drizzle ORM, PGlite (dev) / Postgres (prod), Next.js 16 (reference web), Expo 55 (reference mobile), Electron (reference desktop), Tailwind CSS 4.

**Source design:** `docs/plans/2026-04-19-gmacko-core-finalization-design.md` (committed to master as `a9607c2`).

**Working branch:** `finalize-gmacko-core` in worktree at `~/.config/superpowers/worktrees/gmacko/finalize-gmacko-core/`.

---

## Scope & Deferrals

### In scope for Phase 6
- Scaffold + build out 23 gmacko core packages
- Ship reference apps/web wired end-to-end through gmacko core
- Ship Bob reference theme (amber) based on Bob's DESIGN.md
- Fix `CLAUDE.md` "purple/indigo" → "amber" wording
- Design all git-touching surfaces behind an abstraction (for future Cloudflare Artifacts)
- Drop `apps/server` (Effect-RPC server moves into the Next.js reference app)

### Explicitly deferred (not in this phase)
- Cloudflare Artifacts implementation (dedicated session)
- Bob migration onto gmacko core (Phase 7)
- OODA migration onto gmacko core (Phase 8)
- Moving `packages/wiki` out to `@ooda/wiki` (happens with OODA migration; stays in gmacko for now but not imported by core)
- Moving `packages/ext-ooda` disposition (stays; will be reshaped during OODA migration)
- Research → OODA fold-in (post-OODA-migration)
- Redis pubsub backend implementation (stub only in 6I; real impl during Bob migration when needed)
- ws-gateway backend implementation (stub only in 6I; real impl during Bob migration when needed)
- Full implementations of peripheral packages — `@gmacko/{notifications,storage,monitoring,mcp-server,email,cookies,i18n,settings,analytics,billing,agent-toolkit,mobile-shell,desktop-shell}` get scaffolded with stable public-API surfaces in Phase 6, but their full implementations land during Phase 7 (Bob migration) when concrete callers exist

### Success criteria (from design §7)
1. All 23 core packages exist in `/Volumes/dev/gmacko/packages/` with stable public APIs
2. Reference `apps/web` runs end-to-end: login (better-auth) → create agent session (`@gmacko/agent`) → SSE stream (`@gmacko/realtime`) → runner picks up a task-run (`@gmacko/runner-*`) → secrets provisioned + consumed by runner (`@gmacko/secrets`) → transcript persists to DB + queryable
3. Bob theme renders correctly under `data-theme="bob"` in reference web
4. `@gmacko/db` migrations apply cleanly to a fresh Postgres
5. Tests pass for all core packages

---

## Sub-Phase Roadmap

| Sub-phase | Scope | Status |
|---|---|---|
| **6A** | Scaffolding + foundation packages (`@gmacko/rpc`, `validators`, `config`, tooling) + package-dir scaffolding + `CLAUDE.md` fix | **Detailed below** |
| **6B** | `@gmacko/db` schema normalization — add auth/tenancy/secrets/session/runner tables; keep OODA tables in place (untouched) | Own plan doc TBD |
| **6C** | `@gmacko/auth` — better-auth wrapped as Effect Service, CurrentUser context, tenancy, GitHub OAuth + device flow | Own plan doc TBD |
| **6D** | `@gmacko/secrets` — envelope encryption crypto vault, policies, session scoping, audit, CLI-auth probes, MCP tool surface | Own plan doc TBD |
| **6E** | `@gmacko/agent` — evolve existing `dispatch.ts` into full session primitive (streaming, tool-use, transcript persistence, cancellation) | Own plan doc TBD |
| **6F** | **RPC contract surface + `@gmacko/client` SDK (inserted 2026-04-21 for OODA integration)** — contract groups + stubbed handlers + typed client SDK ahead of service implementations | `docs/plans/2026-04-21-phase6f-contracts.md` |
| **6G** | `@gmacko/runner-protocol` + `@gmacko/runner-base` — Effect/Schema wire contract + shared runtime | Own plan doc TBD |
| **6H** | `@gmacko/realtime` — SSE helpers + in-memory pubsub backend; ws-gateway + Redis backends stubbed | Own plan doc TBD |
| **6I** | `@gmacko/ui` theme mechanism + Bob reference theme (amber, per Bob's DESIGN.md); theme-aware components | Own plan doc TBD |
| **6J** | `@gmacko/app-shell` — auth UI, layout, provider stack for Next.js reference app | Own plan doc TBD |
| **6K** | Wire reference `apps/web` end-to-end; drop `apps/server` | Own plan doc TBD |
| **6L** | E2E validation of §7 success criteria; peripheral package stub-outs | Own plan doc TBD |

Each sub-phase gets its own dedicated detailed plan doc at the time it's picked up (following the `docs/plans/2026-04-17-phase*.md` house style). **Do not attempt to execute 6B–6L from this master doc** — get the dedicated plan first.

---

## Conventions (apply to all sub-phases)

### Package layout

Each `@gmacko/<name>` package follows:

```
packages/<name>/
  package.json       # name: @gmacko/<name>, type: module, exports: { ".": "./src/index.ts" }
  tsconfig.json      # extends ../../tooling/typescript/base.json (or similar)
  src/
    index.ts         # public API barrel — only what callers should import
    <internal>.ts    # implementation files
    __tests__/
      <name>.test.ts # vitest tests
  vitest.config.ts   # vitest setup (if tests exist)
```

### Effect conventions

- RPC groups defined with `RpcGroup.make()` in `@gmacko/contracts`
- Services declared via `Effect.Service<MyService>()("@gmacko/<pkg>/MyService", { effect: ... })`
- Errors are `Schema.TaggedErrorClass` subclasses (see Effect 4 API reference below)
- Service tags (e.g. `CurrentUser`) are `ServiceMap.Service<Self, Shape>()(idString)` — consumed via `yield* ServiceTag.asEffect()` inside `Effect.gen`
- Layers are composed at the app boundary, not in libraries

### Effect 4 API reference (IMPORTANT — read before any Effect task)

The installed version is `effect@4.0.0-beta.43`, which differs significantly from Effect 3.x docs/examples you may encounter. Below are the API renames that apply to gmacko packages. When a later task prompt cites a 3.x-style API, translate using this table:

| Effect 3.x (common in examples) | Effect 4.0.0-beta.43 (use this) | Where verified |
|---|---|---|
| `@effect/rpc` package | `effect/unstable/rpc` (subpath of `effect`) | `node_modules/effect/unstable/rpc/*.d.ts` |
| `@effect/platform` package | `effect/unstable/http` (subpath of `effect`) | `node_modules/effect/unstable/http/*.d.ts` |
| `@effect/platform-node` | `effect/platform/node` subpath or app-layer adapter | verify per use; don't add this dep to shared libraries |
| `Schema.TaggedError<Self>()(id, fields)` | `Schema.TaggedErrorClass<Self>()(id, fields)` | `effect/Schema.d.ts` |
| `Context.Tag("id")<Self, Shape>()` | `ServiceMap.Service<Self, Shape>()("id")` with `yield* Tag.asEffect()` to consume | `effect/ServiceMap.d.ts` |
| `Context` namespace | `ServiceMap` namespace (renamed) | |
| `RpcServer.layerHttpRouter(...)` | `RpcServer.layerHttp(...)` | `effect/unstable/rpc/RpcServer.d.ts` |
| `HttpRouter.HttpRouter.Default` (subtype) | `HttpRouter.HttpRouter` (the service directly) | `effect/unstable/http/HttpRouter.d.ts` |
| `RpcGroup.HandlersContext<R>` type | `Rpc.HandlersServices<Rpcs>` (per-handler) | `effect/unstable/rpc/Rpc.d.ts` |
| Tag consumed via `Tag.pipe(Effect.flatMap(...))` | `Effect.gen(function* () { const svc = yield* Tag.asEffect(); ... })` | |
| `Schema.pattern(re)` | `Schema.check(Schema.isPattern(re))` | `effect/Schema.d.ts` |
| `Schema.minLength(n)` | `Schema.check(Schema.isMinLength(n))` | `effect/Schema.d.ts` |
| `Schema.DateFromString` | compose: `Schema.DateTimeUtcFromString.pipe(Schema.decodeTo(Schema.Date, { decode: SchemaGetter.transform(DateTime.toDateUtc), encode: SchemaGetter.transform(DateTime.fromDateUnsafe) }))` — no literal equivalent | see `packages/validators/src/common.ts` |
| `Schema.transform(source, target, { decode, encode })` standalone | does not exist; use `Schema.decodeTo(target, { decode: SchemaGetter.transform(fn), encode: SchemaGetter.transform(fn) })` piped onto source | `effect/Schema.d.ts`, `effect/SchemaGetter.d.ts` |
| `DateTime.unsafeFromDate` | `DateTime.fromDateUnsafe` (suffix style) | `effect/DateTime.d.ts` |
| `Schema.decodeUnknown(schema)(input)` (Effect) | `Schema.decodeUnknownEffect(schema)(input)` — explicit variant suffix | `effect/Schema.d.ts` |
| `Schema.ParseResult.ParseError` / `ParseError` | `Schema.SchemaError` (flat class, tag `"SchemaError"`) | `effect/Schema.d.ts` |
| `Schema.Literal("a", "b", "c")` for union | `Schema.Literals(["a", "b", "c"])` (array arg; `Literal` is single-value only) | `effect/Schema.d.ts` |
| `Schema.startsWith(s)` | `Schema.check(Schema.isStartsWith(s))` | `effect/Schema.d.ts` |
| `Schema.int()` | `Schema.check(Schema.isInt())` — `isInt` is a function, must be invoked | `effect/Schema.d.ts` |
| `Schema.between(min, max)` | `Schema.check(Schema.isBetween({ minimum, maximum }))` — options object | `effect/Schema.d.ts` |
| Generic constraint `<T, I>` with `Schema.Schema<A, I>` | `<S extends Schema.Top>` with `S["Type"]`, `S["Encoded"]`, `S["DecodingServices"]` | `effect/Schema.d.ts` |
| `Layer.effect(tag, effect)` | `Layer.effect(effect)` — tag moved into `ServiceMap.Service` itself; no tag param | `effect/Layer.d.ts:891` |
| `Layer.succeed(tag, value)` | `Layer.succeed(value)` — same; no tag param | `effect/Layer.d.ts:624` |
| `Layer.scoped(tag, scopedEffect)` | `Layer.effectServices(scopedEffect)` (no direct `scoped` export) | `effect/Layer.d.ts:983` |
| `Stream.async(emit => ...)` callback push-style | **REMOVED** — use Queue + `Stream.fromQueue` for push, or pull-based Channel primitives | not in `Stream.d.ts` |
| `Stream.asyncEffect(...)` | **REMOVED** — same; wrap a Queue | not in `Stream.d.ts` |
| `RpcResolver.make(group)` | `RpcClient.make(group)` — no RpcResolver module anymore | `effect/unstable/rpc/RpcClient.d.ts:93` |
| `RpcClient.make(group, protocol)` with Protocol arg | `RpcClient.make(group)` — Protocol is a service; provide via `RpcClient.layerProtocolHttp()` | `effect/unstable/rpc/RpcClient.d.ts:93, 156` |
| `Effect.either(effect)` | **not exported** — use `Effect.catchTag` / `Effect.catchCause` or `Effect.exit` | not in `effect/Effect.d.ts` (6C) |
| `Cause.failures(cause)` fn | **not a function** — `Cause` in beta.43 uses different iteration; use `Effect.catchCause` with `Cause.match` for cases | `effect/Cause.d.ts` (6C) |
| `Effect.forkDaemon(effect)` | `Effect.forkDetach(effect)` (renamed) | `effect/Effect.d.ts` (6C) |
| `Effect.catchAllCause(handler)` | `Effect.catchCause(handler)` (renamed) | `effect/Effect.d.ts` (6C) |
| `Layer.provideMerge(child, parent)` | `Layer.provide(child, parent)` + `Layer.merge(a, b)` explicitly — `provideMerge` propagates requirements to outer layer | `effect/Layer.d.ts` (6C) |
| `RpcMiddleware.Service` ergonomics | Runtime shape receives `Effect<SuccessValue, ...>` where `SuccessValue` is an opaque unique-symbol type; unit-testing in isolation requires casting. Prefer plain-function middleware + wrap with `RpcMiddleware.Service` at transport boundary. | `effect/unstable/rpc/RpcMiddleware.d.ts` (6C) |
| `HttpServerRequest.cookies` access | Cookies live on `HttpServerRequest` (a `ServiceMap.Service`), not on `RpcMiddleware` headers. Middleware needing cookies needs both services injected. | `effect/unstable/http/HttpServerRequest.d.ts` (6C) |
| `Effect.tryPromise({try, catch})` with drizzle driver errors | Under `@effect/vitest`, driver-level exceptions (e.g. PGlite unique-violation) leak to the fiber Cause and surface as test-logger errors even when caught to a typed error. Tests flake or fail with the raw driver message. **Workaround:** pre-check via SELECT before INSERT/UPDATE to surface typed errors without ever triggering the driver exception. Race window is acceptable for user-initiated serial call sites. | `@effect/vitest@4.0.0-beta.43` + drizzle + pglite (6D) |
| `Effect.async((resume) => ...)` for event bridging | Renamed to **`Effect.callback((resume) => ...)`** in beta.43. The register callback may return an `Effect<void>` that runs as a cleanup handler on interruption (e.g. detach listeners). | `effect/Effect.d.ts` (6E) |
| `Effect.fork(effect)` | Does not exist as `Effect.fork` in beta.43. Use `Effect.forkChild` (supervised) or `Effect.forkDetach` (daemon) or `Effect.forkScoped` (bound to current scope). | `effect/Effect.d.ts` (6E) |
| `Effect.forkDetach(effect)` single-arg | Accepts an options object: `Effect.forkDetach(effect, { startImmediately: true })` is required to guarantee the forked fiber runs before the current fiber yields. Without `startImmediately`, a producer fiber may not emit events before a consumer starts reading. | `effect/Effect.d.ts` (6E) |
| Adapter/producer fibers in a caller's scope | Use **`Effect.forkScoped`** — the fiber is interrupted automatically when the enclosing scope closes. `forkDetach` runs in the global scope and leaks past test teardown (we hit exactly this with an emitter that kept PGlite transactions open past `afterEach`). Prefer `forkScoped` for anything that emits into a caller-supplied Queue/Stream. | `effect/Effect.d.ts` (6E) |
| `Queue.shutdown(q)` to signal end-of-stream | **WRONG for drain-then-close.** `Queue.shutdown` cancels pending ops AND drops buffered events, surfacing as `"All fibers interrupted without error"` in a downstream consumer. Use **`Queue.end(q)`** for clean drain-then-close; type the queue as `Queue<A, E \| Cause.Done>` and `Stream.fromQueue`'s `Exclude<E, Cause.Done>` filters Done out of the stream's error channel. For errored end, `Queue.fail(q, error)` takes the raw typed error (no `Cause.fail` wrapping). | `effect/Queue.d.ts` (6E) |
| `Stream.ensuringWith(stream, finalizer)` | Not exported in beta.43. Use **`Stream.onExit(finalizer)`** where `finalizer: (exit: Exit<unknown, E>) => Effect<unknown, never, R>`. Runs in the consumer's fiber at stream termination (success, failure, or interruption). | `effect/Stream.d.ts` (6E) |
| `Stream.catchAll(handler)` | Does not exist. Use `Stream.catchCause`, `Stream.catchTag`, `Stream.catchTags`, `Stream.catchIf`, `Stream.catchFilter`, `Stream.catchReason(s)`, or their `catchCauseIf`/`catchCauseFilter` variants. | `effect/Stream.d.ts` (6E) |
| `@effect/vitest` `it.effect` timing | Installs a `TestClock`. `Effect.sleep(...)` inside the test (or inside acquired scope finalizers) does NOT advance real time — you must `TestClock.adjust(...)` OR use **`it.live`** instead. Use `it.live` whenever the test observes real subprocess timing, child-process exit signals, or any real-wall-clock behavior. | `@effect/vitest@4.0.0-beta.43` (6E) |
| `Stream.interruptWhen(deferred)` for mid-stream cancel | Available in beta.43 and is the idiomatic cancel mechanism: create `Deferred<void>`, pipe the stream through `Stream.interruptWhen(Deferred.await(d))`, and a separate code path fires `Deferred.succeed(d, void 0)` to terminate the stream. Be aware the interrupt path produces a Failure Exit (interrupt-only cause), which `Exit.isSuccess(exit)` reports as non-success — use `Cause.hasInterruptsOnly` to distinguish from genuine failures inside `Stream.onExit` finalizers. | `effect/Stream.d.ts`, `effect/Cause.d.ts` (6E) |

> **SSE in Effect 4 (updated from 6E):** The master plan previously recommended `Queue.shutdown` to signal end-of-stream. **This is wrong.** Use `Queue.end(queue)` for clean drain-then-close, `Queue.fail(queue, error)` for errored end. Type the queue as `Queue<A, E | Cause.Done>` so `Queue.end` typechecks; `Stream.fromQueue`'s signature `<A, E>(q) => Stream<A, Exclude<E, Cause.Done>>` filters `Cause.Done` out of the consumer's error channel. This applies to agent-token streams (6E, now landed) and realtime event fan-out (6G).

**When a task's code snippet doesn't compile:** the fix is almost always one of the table rows above. Don't invent shims; translate and proceed. If a translation isn't in the table, stop and investigate (check `node_modules/effect/*.d.ts` for the real surface) rather than guessing.

**Verified reference implementation:** `packages/rpc/src/*.ts` (landed in Task 6) is idiomatic Effect 4 and can be treated as the canonical example for shared gmacko packages that use RPC/services/tagged errors.

### Test conventions

- Use `vitest` (already present in workspace)
- Co-locate tests under `src/__tests__/`
- Every public API function has at least one test
- Tests run with `pnpm test` at the package root; `pnpm -r test` at repo root (via Turbo)
- Use `@effect/vitest` helpers (`it.effect`) for Effect-producing tests

### Commit conventions

- Follow existing repo style: lowercase type + colon + lowercase summary
  - `feat: add effect service wrapper for better-auth`
  - `test: add session-secret vault round-trip test`
  - `chore: scaffold @gmacko/rpc package`
- Commit after each task (TDD cycle: test → impl → passing → commit)

---

# Sub-Phase 6A: Scaffolding & Foundation

**Goal of 6A:** Get the repo ready to build on. Fix the known wrong thing (CLAUDE.md), scaffold empty package skeletons for all 23 core packages so the inventory is visible, and build out the three foundation packages (`@gmacko/rpc`, `@gmacko/validators`, `@gmacko/config`) that everything else depends on.

**Exit criteria for 6A:**
- All 23 core packages have a package.json + src/index.ts + tsconfig.json (may be stub `export {}` for the ones not yet implemented)
- `pnpm install` + `pnpm -r typecheck` passes at repo root
- `@gmacko/rpc` + `@gmacko/validators` + `@gmacko/config` have real implementations with tests passing
- `CLAUDE.md` correctly describes Bob theme as amber, not purple/indigo
- Working tree is clean; all 6A commits land on branch `finalize-gmacko-core`

---

## Task 1: Fix CLAUDE.md Bob theme description

**Files:**
- Modify: `CLAUDE.md` (around line that says `"bob"` or `"purple/indigo"`)

**Step 1: Read current wording**

Run: `grep -n "purple\|indigo\|bob" CLAUDE.md`

Expected: a line like `Set \`data-theme\` attribute: \`"ooda"\` (dark + gold) or \`"bob"\` (purple/indigo).`

**Step 2: Edit wording**

Replace the Themes section with:

```markdown
## Themes

Set `data-theme` attribute: `"ooda"` (dark + gold — placeholder) or `"bob"` (amber + warm gray — per Bob's DESIGN.md: primary #D4850A, Satoshi + DM Sans, Industrial/utilitarian).
```

**Step 3: Verify**

Run: `grep -n "purple\|indigo" CLAUDE.md`

Expected: no output.

Run: `grep -n "amber" CLAUDE.md`

Expected: the new line.

**Step 4: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: correct CLAUDE.md bob theme from purple/indigo to amber"
```

---

## Task 2: Add shared tooling scaffolding — confirm or create `tooling/typescript/base.json`

**Files:**
- Check: `tooling/typescript/base.json`
- Check: `tooling/typescript/package.json` (for `@gmacko/tsconfig` workspace package)
- Create if missing: above files

**Step 1: Check existence**

Run: `ls tooling/`

Expected: `typescript/` subdir exists (from existing skeleton).

Run: `cat tooling/typescript/base.json`

Expected: shared tsconfig JSON with strict mode, moduleResolution "Bundler", target "ES2022" or similar.

**If the file is missing or sparse**, add this content:

```json
{
  "$schema": "https://json.schemastore.org/tsconfig",
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2022"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "exactOptionalPropertyTypes": true,
    "allowImportingTsExtensions": false,
    "resolveJsonModule": true,
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true,
    "skipLibCheck": true,
    "isolatedModules": true,
    "verbatimModuleSyntax": true,
    "noEmit": true
  },
  "exclude": ["node_modules", "dist", "build", ".next"]
}
```

**Step 2: Check tooling/typescript/package.json**

Run: `cat tooling/typescript/package.json`

Expected: `{ "name": "@gmacko/tsconfig", ... }`.

If missing:

```json
{
  "name": "@gmacko/tsconfig",
  "private": true,
  "version": "0.0.0",
  "files": ["base.json", "nextjs.json", "react-library.json"]
}
```

**Step 3: Commit (if changes needed)**

```bash
git add tooling/typescript/
git commit -m "chore: ensure shared tsconfig base exists"
```

If no changes were needed, skip the commit.

---

## Task 3: Scaffold empty package dirs for all 23 core packages

**Files:**
- Create: `packages/<name>/package.json` + `packages/<name>/src/index.ts` + `packages/<name>/tsconfig.json` for each missing package

**Step 1: Inventory what exists vs what's needed**

Current packages (from `ls packages/`):
- `agent` (exists — evolves in 6E)
- `contracts` (exists)
- `db` (exists — evolves in 6B)
- `ext-ooda` (exists — stays, reshaped in OODA migration)
- `models` (exists — see Task 4)
- `ui` (exists — evolves in 6I)
- `wiki` (exists — stays, not imported by core)

Packages to create (empty stubs):

1. `@gmacko/rpc`
2. `@gmacko/validators`
3. `@gmacko/config`
4. `@gmacko/auth`
5. `@gmacko/secrets`
6. `@gmacko/realtime`
7. `@gmacko/ws-gateway`
8. `@gmacko/runner-protocol`
9. `@gmacko/runner-base`
10. `@gmacko/notifications`
11. `@gmacko/storage`
12. `@gmacko/monitoring`
13. `@gmacko/mcp-server`
14. `@gmacko/email`
15. `@gmacko/cookies`
16. `@gmacko/i18n`
17. `@gmacko/settings`
18. `@gmacko/analytics`
19. `@gmacko/billing`
20. `@gmacko/agent-toolkit`
21. `@gmacko/app-shell`
22. `@gmacko/mobile-shell`
23. `@gmacko/desktop-shell`

**Step 2: Create stub for each missing package**

Script to generate all stubs at once (save to a file, run once, then delete):

```bash
# File: scripts/scaffold-phase6-packages.sh
#!/usr/bin/env bash
set -e

PACKAGES=(
  rpc validators config auth secrets realtime ws-gateway
  runner-protocol runner-base notifications storage monitoring
  mcp-server email cookies i18n settings analytics billing
  agent-toolkit app-shell mobile-shell desktop-shell
)

for pkg in "${PACKAGES[@]}"; do
  if [ -d "packages/$pkg" ]; then
    echo "skip: packages/$pkg exists"
    continue
  fi

  mkdir -p "packages/$pkg/src"

  cat > "packages/$pkg/package.json" <<EOF
{
  "name": "@gmacko/$pkg",
  "private": true,
  "version": "0.0.0",
  "type": "module",
  "exports": { ".": "./src/index.ts" },
  "scripts": {
    "typecheck": "tsc --noEmit"
  },
  "devDependencies": {
    "@gmacko/tsconfig": "workspace:*",
    "typescript": "^5.9.0"
  }
}
EOF

  cat > "packages/$pkg/tsconfig.json" <<EOF
{
  "extends": "../../tooling/typescript/tsconfig.base.json",
  "include": ["src/**/*"]
}
EOF

  cat > "packages/$pkg/src/index.ts" <<EOF
// @gmacko/$pkg — scaffolded in Phase 6A; implementation in a later sub-phase
export {};
EOF

  echo "created: packages/$pkg"
done
```

Run: `bash scripts/scaffold-phase6-packages.sh`

Expected: 23 directories created (or skipped if already exist).

**Step 3: Install dependencies to pick up the new workspace members**

Run: `pnpm install`

Expected: no errors; new packages recognized as workspace members.

**Step 4: Typecheck all packages**

Run: `pnpm -r typecheck`

Expected: all packages pass (they're empty stubs — nothing to typecheck except the base tsconfig being resolvable).

**Step 5: Delete the scaffolding script (not needed after use)**

Run: `rm scripts/scaffold-phase6-packages.sh`

**Step 6: Commit**

```bash
git add packages/
git commit -m "chore: scaffold empty dirs for 23 phase-6 gmacko core packages"
```

---

## Task 4: Decide `@gmacko/models` fate

**Files:**
- Read: `packages/models/src/*.ts`
- Read: all consumers of `@gmacko/models` (grep across packages + apps)

**Step 1: Inventory what's in `@gmacko/models`**

Run: `ls packages/models/src/`

Expected: `branch.ts`, `message.ts`, `thread.ts`, `index.ts`.

Read each file to understand the shape.

**Step 2: Inventory consumers**

Run: `grep -rn "@gmacko/models" --include="*.ts" --include="*.tsx" --include="package.json" . | grep -v node_modules`

Expected: list of files importing `@gmacko/models`.

**Step 3: Apply decision rule**

- If `@gmacko/models` contents are **product-agnostic domain models** (e.g. generic "Thread" that makes sense for both Bob and OODA), keep the package and document its role
- If contents are **OODA-specific** (research-thread shaped, exploration concerns), these should be marked for eventual move to `@ooda/thread-model` during the OODA migration; for now, leave in place but add a comment to `packages/models/src/index.ts` noting "OODA-adjacent; will reshape during OODA migration"
- If contents duplicate what's already in `@gmacko/contracts` (schemas for thread/branch/message), consider `@gmacko/models` redundant — but defer deletion to the OODA migration (removing it now forces consumer churn unnecessarily)

**Likely outcome:** the current contents look OODA-adjacent (exploration/thread model around the current UI). Leave in place; add a header note.

**Step 4: Add header note**

Edit `packages/models/src/index.ts` — prepend:

```typescript
// NOTE: @gmacko/models currently holds OODA-adjacent domain types
// (exploration threads, branches, messages for chat UI). These will be
// reshaped during OODA migration (@ooda/thread-model). For Phase 6, this
// package is NOT a dependency of any new gmacko core package.
```

**Step 5: Commit**

```bash
git add packages/models/src/index.ts
git commit -m "docs: annotate @gmacko/models as OODA-adjacent, not a core dep"
```

---

## Task 5: Drop `apps/server` (server will live in apps/web)

**Files:**
- Delete: `apps/server/` (entire directory)
- Modify: any references in `package.json`, `turbo.json`, `pnpm-workspace.yaml`, scripts

**Step 1: Inventory references**

Run: `grep -rn "apps/server\|@gmacko/server" --include="*.json" --include="*.yaml" --include="*.ts" --include="*.sh" --include="*.md" . | grep -v node_modules`

Expected: list of files that reference `apps/server`.

**Step 2: Verify nothing in apps/server is irreplaceable**

Read `apps/server/src/` files. Any Effect-RPC handler shells, middleware patterns, or examples should be preserved by copying useful snippets into notes for 6J (app-shell wiring). The directory's contents get deleted once snippets are captured.

Save useful patterns to a scratch file: `docs/plans/scratch/apps-server-salvage.md` (temporary; will delete at end of 6A).

**Step 3: Remove apps/server directory**

Run: `git rm -r apps/server/`

Expected: all files staged for deletion.

**Step 4: Remove references from workspace config**

- `pnpm-workspace.yaml` — the `apps/*` glob covers it, nothing to change
- `turbo.json` — search for any apps/server-specific pipeline entries; remove if present
- Root `package.json` scripts — remove any `dev:server` or similar

**Step 5: Verify install still works**

Run: `pnpm install`

Expected: success.

**Step 6: Typecheck**

Run: `pnpm -r typecheck`

Expected: success.

**Step 7: Commit**

```bash
git add apps/ pnpm-workspace.yaml turbo.json package.json
git commit -m "chore: drop apps/server (effect-rpc server will live in apps/web)"
```

Delete the scratch salvage file:

```bash
rm -rf docs/plans/scratch
```

---

## Task 6: Build `@gmacko/rpc` — Effect-RPC framework plumbing

**Files:**
- Modify: `packages/rpc/package.json` (add deps)
- Create: `packages/rpc/src/errors.ts`
- Create: `packages/rpc/src/context.ts`
- Create: `packages/rpc/src/middleware.ts`
- Create: `packages/rpc/src/server.ts`
- Modify: `packages/rpc/src/index.ts` (barrel)
- Create: `packages/rpc/src/__tests__/server.test.ts`
- Create: `packages/rpc/vitest.config.ts`

**Step 1: Add dependencies**

Edit `packages/rpc/package.json`:

```json
{
  "name": "@gmacko/rpc",
  "private": true,
  "version": "0.0.0",
  "type": "module",
  "exports": {
    ".": "./src/index.ts",
    "./server": "./src/server.ts",
    "./errors": "./src/errors.ts",
    "./context": "./src/context.ts"
  },
  "scripts": {
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "effect": "4.0.0-beta.43",
    "@effect/platform": "4.0.0-beta.43",
    "@effect/platform-node": "4.0.0-beta.43"
  },
  "devDependencies": {
    "@gmacko/tsconfig": "workspace:*",
    "@effect/vitest": "4.0.0-beta.43",
    "typescript": "^5.9.0",
    "vitest": "^3.0.0"
  }
}
```

Run: `pnpm install`.

**Step 2: Write the failing test first** (TDD)

Create `packages/rpc/src/__tests__/server.test.ts`:

```typescript
import { describe, expect } from "vitest";
import { it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import { Rpc, RpcGroup, RpcServer } from "@effect/rpc";
import { Schema } from "effect";
import { makeRpcServerLayer } from "../server.js";

const Echo = Rpc.make("Echo", {
  success: Schema.String,
  payload: { message: Schema.String },
});

const TestGroup = RpcGroup.make(Echo);

describe("@gmacko/rpc server", () => {
  it.effect("serves an RPC call end-to-end", () =>
    Effect.gen(function* () {
      const handler = TestGroup.toLayer({
        Echo: (req) => Effect.succeed(`echo:${req.message}`),
      });

      const serverLayer = makeRpcServerLayer(TestGroup).pipe(
        Layer.provide(handler),
      );

      // Verify the layer builds without error (smoke test for Phase 6A)
      yield* Layer.build(serverLayer).pipe(Effect.scoped);
    })
  );
});
```

**Step 3: Create vitest config**

Create `packages/rpc/vitest.config.ts`:

```typescript
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/__tests__/**/*.test.ts"],
  },
});
```

**Step 4: Run test — expect failure**

Run: `pnpm --filter @gmacko/rpc test`

Expected: FAIL with "Cannot find module '../server.js'" or similar import error.

**Step 5: Implement errors module**

Create `packages/rpc/src/errors.ts`:

```typescript
import { Schema } from "effect";

export class RpcError extends Schema.TaggedError<RpcError>()("RpcError", {
  message: Schema.String,
  cause: Schema.optional(Schema.Unknown),
}) {}

export class UnauthorizedError extends Schema.TaggedError<UnauthorizedError>()(
  "UnauthorizedError",
  { message: Schema.String },
) {}

export class NotFoundError extends Schema.TaggedError<NotFoundError>()(
  "NotFoundError",
  { entity: Schema.String, id: Schema.String },
) {}
```

**Step 6: Implement context module**

Create `packages/rpc/src/context.ts`:

```typescript
import { Context } from "effect";

// CurrentUser is populated by auth middleware and consumed by handlers.
// The real shape lives in @gmacko/auth; this file declares the tag only
// to avoid a circular package dep.
export interface CurrentUserShape {
  readonly userId: string;
  readonly tenantId: string;
  readonly email: string;
}

export class CurrentUser extends Context.Tag("@gmacko/rpc/CurrentUser")<
  CurrentUser,
  CurrentUserShape
>() {}
```

**Step 7: Implement middleware module**

Create `packages/rpc/src/middleware.ts`:

```typescript
import { Effect } from "effect";
import { UnauthorizedError } from "./errors.js";
import { CurrentUser } from "./context.js";

// Guard that requires an authenticated user in context.
// Handlers needing auth wrap their Effect with requireAuth.
export const requireAuth = <A, E, R>(
  eff: Effect.Effect<A, E, R>,
): Effect.Effect<A, E | UnauthorizedError, R | CurrentUser> =>
  CurrentUser.pipe(
    Effect.flatMap((user) =>
      user.userId
        ? eff
        : Effect.fail(
            new UnauthorizedError({ message: "No authenticated user" }),
          ),
    ),
  );
```

**Step 8: Implement server module**

Create `packages/rpc/src/server.ts`:

```typescript
import { Layer } from "effect";
import { RpcGroup, RpcSerialization, RpcServer } from "@effect/rpc";
import { HttpRouter } from "@effect/platform";

// Build a Layer that serves a given RpcGroup over HTTP.
// Apps compose this with their auth/db/realtime layers.
export const makeRpcServerLayer = <R extends RpcGroup.Any>(
  group: R,
): Layer.Layer<HttpRouter.HttpRouter.Default, never, RpcServer.Protocol | RpcGroup.HandlersContext<R>> =>
  RpcServer.layerHttpRouter({
    group,
    path: "/rpc",
    protocol: "http",
  });

export const serializationLayer = RpcSerialization.layerJson;
```

**Step 9: Update barrel**

Edit `packages/rpc/src/index.ts`:

```typescript
export * from "./errors.js";
export * from "./context.js";
export * from "./middleware.js";
export * from "./server.js";
```

**Step 10: Run test — expect pass**

Run: `pnpm --filter @gmacko/rpc test`

Expected: PASS.

**Step 11: Typecheck**

Run: `pnpm --filter @gmacko/rpc typecheck`

Expected: success (no errors).

**Step 12: Commit**

```bash
git add packages/rpc/
git commit -m "feat: add @gmacko/rpc effect-rpc framework plumbing"
```

---

## Task 7: Build `@gmacko/validators` — shared schema helpers

**Files:**
- Modify: `packages/validators/package.json`
- Create: `packages/validators/src/common.ts`
- Create: `packages/validators/src/ids.ts`
- Modify: `packages/validators/src/index.ts`
- Create: `packages/validators/src/__tests__/ids.test.ts`
- Create: `packages/validators/vitest.config.ts`

**Step 1: Add deps**

Edit `packages/validators/package.json`:

```json
{
  "name": "@gmacko/validators",
  "private": true,
  "version": "0.0.0",
  "type": "module",
  "exports": { ".": "./src/index.ts" },
  "scripts": {
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "effect": "4.0.0-beta.43"
  },
  "devDependencies": {
    "@gmacko/tsconfig": "workspace:*",
    "@effect/vitest": "4.0.0-beta.43",
    "typescript": "^5.9.0",
    "vitest": "^3.0.0"
  }
}
```

Run: `pnpm install`.

**Step 2: Write failing test**

Create `packages/validators/src/__tests__/ids.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { Schema } from "effect";
import { UserId, TenantId, SessionId } from "../ids.js";

describe("@gmacko/validators/ids", () => {
  it("accepts valid UUIDs", () => {
    const id = "550e8400-e29b-41d4-a716-446655440000";
    expect(Schema.decodeUnknownSync(UserId)(id)).toBe(id);
    expect(Schema.decodeUnknownSync(TenantId)(id)).toBe(id);
    expect(Schema.decodeUnknownSync(SessionId)(id)).toBe(id);
  });

  it("rejects non-UUIDs", () => {
    expect(() => Schema.decodeUnknownSync(UserId)("not-a-uuid")).toThrow();
  });

  it("brands ids so UserId and TenantId are not interchangeable", () => {
    const raw = "550e8400-e29b-41d4-a716-446655440000";
    const u: typeof UserId.Type = Schema.decodeUnknownSync(UserId)(raw);
    // @ts-expect-error — UserId is not assignable to TenantId (branded)
    const t: typeof TenantId.Type = u;
  });
});
```

**Step 3: Create vitest config**

Create `packages/validators/vitest.config.ts`:

```typescript
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/__tests__/**/*.test.ts"],
  },
});
```

**Step 4: Run test — expect failure**

Run: `pnpm --filter @gmacko/validators test`

Expected: FAIL (module not found).

**Step 5: Implement ids module**

Create `packages/validators/src/ids.ts`:

```typescript
import { Schema } from "effect";

const UuidString = Schema.String.pipe(
  Schema.pattern(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
  ),
);

export const UserId = UuidString.pipe(Schema.brand("UserId"));
export type UserId = typeof UserId.Type;

export const TenantId = UuidString.pipe(Schema.brand("TenantId"));
export type TenantId = typeof TenantId.Type;

export const SessionId = UuidString.pipe(Schema.brand("SessionId"));
export type SessionId = typeof SessionId.Type;

export const RunnerDeviceId = UuidString.pipe(Schema.brand("RunnerDeviceId"));
export type RunnerDeviceId = typeof RunnerDeviceId.Type;

export const TaskRunId = UuidString.pipe(Schema.brand("TaskRunId"));
export type TaskRunId = typeof TaskRunId.Type;

export const SessionSecretId = UuidString.pipe(Schema.brand("SessionSecretId"));
export type SessionSecretId = typeof SessionSecretId.Type;
```

**Step 6: Implement common module**

Create `packages/validators/src/common.ts`:

```typescript
import { Schema } from "effect";

export const Timestamp = Schema.DateFromString;
export const NonEmptyString = Schema.String.pipe(Schema.minLength(1));
export const Email = Schema.String.pipe(
  Schema.pattern(/^[^@\s]+@[^@\s]+\.[^@\s]+$/),
);
```

**Step 7: Update barrel**

Edit `packages/validators/src/index.ts`:

```typescript
export * from "./ids.js";
export * from "./common.js";
```

**Step 8: Run test — expect pass**

Run: `pnpm --filter @gmacko/validators test`

Expected: PASS (3 tests).

**Step 9: Typecheck**

Run: `pnpm --filter @gmacko/validators typecheck`

Expected: success.

**Step 10: Commit**

```bash
git add packages/validators/
git commit -m "feat: add @gmacko/validators with branded id schemas"
```

---

## Task 8: Build `@gmacko/config` — env loading with Effect/Schema

**Files:**
- Modify: `packages/config/package.json`
- Create: `packages/config/src/env.ts`
- Create: `packages/config/src/load.ts`
- Modify: `packages/config/src/index.ts`
- Create: `packages/config/src/__tests__/load.test.ts`
- Create: `packages/config/vitest.config.ts`

**Step 1: Add deps**

Edit `packages/config/package.json`:

```json
{
  "name": "@gmacko/config",
  "private": true,
  "version": "0.0.0",
  "type": "module",
  "exports": { ".": "./src/index.ts" },
  "scripts": {
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "effect": "4.0.0-beta.43"
  },
  "devDependencies": {
    "@gmacko/tsconfig": "workspace:*",
    "@effect/vitest": "4.0.0-beta.43",
    "typescript": "^5.9.0",
    "vitest": "^3.0.0"
  }
}
```

Run: `pnpm install`.

**Step 2: Write failing test**

Create `packages/config/src/__tests__/load.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { Effect, Schema } from "effect";
import { loadConfig } from "../load.js";

describe("@gmacko/config loadConfig", () => {
  it("loads valid env vars against a schema", async () => {
    const schema = Schema.Struct({
      DATABASE_URL: Schema.String,
      PORT: Schema.NumberFromString,
    });

    const env = { DATABASE_URL: "postgres://local", PORT: "3000" };
    const result = await Effect.runPromise(loadConfig(schema, env));
    expect(result).toEqual({ DATABASE_URL: "postgres://local", PORT: 3000 });
  });

  it("fails loudly on missing required var", async () => {
    const schema = Schema.Struct({ DATABASE_URL: Schema.String });
    const result = Effect.runPromise(loadConfig(schema, {}));
    await expect(result).rejects.toThrow();
  });
});
```

**Step 3: Create vitest config**

Create `packages/config/vitest.config.ts`:

```typescript
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/__tests__/**/*.test.ts"],
  },
});
```

**Step 4: Run test — expect failure**

Run: `pnpm --filter @gmacko/config test`

Expected: FAIL (module not found).

**Step 5: Implement load module**

Create `packages/config/src/load.ts`:

```typescript
import { Effect, Schema } from "effect";

// Decode a Schema against process.env (or an injected record for tests).
// Fails with a Schema.ParseError on invalid/missing vars.
export const loadConfig = <A, I extends Record<string, string>>(
  schema: Schema.Schema<A, I>,
  env: Record<string, string | undefined> = process.env,
): Effect.Effect<A, Schema.ParseResult.ParseError> => {
  const input: Record<string, string> = {};
  for (const [k, v] of Object.entries(env)) {
    if (typeof v === "string") input[k] = v;
  }
  return Schema.decodeUnknown(schema)(input) as Effect.Effect<
    A,
    Schema.ParseResult.ParseError
  >;
};
```

**Step 6: Implement env module (reusable env schemas)**

Create `packages/config/src/env.ts`:

```typescript
import { Schema } from "effect";

// Common env-var schemas that gmacko packages can reuse.
export const NodeEnv = Schema.Literal("development", "test", "production");

export const PostgresUrl = Schema.String.pipe(
  Schema.startsWith("postgres://"),
);

export const Port = Schema.NumberFromString.pipe(
  Schema.int(),
  Schema.between(1, 65535),
);
```

**Step 7: Update barrel**

Edit `packages/config/src/index.ts`:

```typescript
export * from "./load.js";
export * from "./env.js";
```

**Step 8: Run test — expect pass**

Run: `pnpm --filter @gmacko/config test`

Expected: PASS (2 tests).

**Step 9: Typecheck**

Run: `pnpm --filter @gmacko/config typecheck`

Expected: success.

**Step 10: Commit**

```bash
git add packages/config/
git commit -m "feat: add @gmacko/config env loader with effect/schema"
```

---

## Phase 6A — Completed ✅

Tagged `phase-6a-complete`. 30 packages present. 23 typechecks passing. 45 tests passing. `apps/server` removed. Clean tree.

### Open items carried into 6B onboarding

From the Phase 6A final code review (`agent-teams:team-reviewer`):

- **Effect 4 API drift-check before 6B.** The API reference table in §Conventions currently covers `RpcServer`, `Schema`, `DateTime`. Before starting 6B, spend 10 minutes in `node_modules/effect/unstable/rpc/RpcClient.d.ts`, `effect/Stream.d.ts`, and `effect/Layer.d.ts` and append any 3.x→4.x drift to the table. 6E (`@gmacko/agent` streaming) and 6H (`@gmacko/realtime` SSE) will hit these first.
- **`@gmacko/rpc` needs real coverage when 6C lands.** Current tests are smoke-only (`server.test.ts:29`). When `@gmacko/auth` adds `CurrentUser` population, add: (1) `requireAuth` success path with a provided `CurrentUser`, (2) `requireAuth` failure path returning `UnauthorizedError`, (3) full RPC round-trip exercising error serialization. Carry this into the 6C plan doc.
- **`PostgresUrl` should also accept `postgresql://`** (`packages/config/src/env.ts:10-12`). Drizzle + pg both accept the longer scheme. Fix when 6B wires `DATABASE_URL`.
- **Scaffolded stubs lack descriptions.** Each of the 20 unfilled packages has `// … scaffolded … export {};` with no package.json `description` field. When 6B–6L pick up each package, add a one-line planned responsibility + `description` — improves discoverability and shows up in `pnpm ls`.
- **Convention to carry forward:** every sub-phase commits a dedicated plan doc first (with drift table updates), then tasks with TDD, then an exit-criteria verification commit before tagging. 6A followed this pattern; keep it.

---

## Task 9: Verify 6A exit criteria

**Step 1: Check package inventory**

Run:

```bash
ls packages/ | sort
```

Expected — all 30 entries (23 new + 7 existing):

```
agent
agent-toolkit
analytics
app-shell
auth
billing
config
contracts
cookies
db
desktop-shell
email
ext-ooda
i18n
mcp-server
mobile-shell
models
monitoring
notifications
realtime
rpc
runner-base
runner-protocol
secrets
settings
storage
ui
validators
wiki
ws-gateway
```

**Step 2: Typecheck everything**

Run: `pnpm -r typecheck`

Expected: all packages pass.

**Step 3: Test everything**

Run: `pnpm test` (from repo root — turbo)

Expected:
- `@gmacko/ui` — 15 tests pass (baseline)
- `@gmacko/wiki` — 8 tests pass (baseline)
- `@gmacko/rpc` — 1 test passes (new)
- `@gmacko/validators` — 3 tests pass (new)
- `@gmacko/config` — 2 tests pass (new)
- Total: 29 tests pass, 0 fail

**Step 4: Verify `apps/server` is gone**

Run: `ls apps/`

Expected: `desktop mobile web` (no `server`).

**Step 5: Verify CLAUDE.md fix**

Run: `grep -n "purple\|indigo" CLAUDE.md`

Expected: no output.

**Step 6: Verify clean tree**

Run: `git status`

Expected: `nothing to commit, working tree clean`.

**Step 7: Commit a milestone marker (optional but useful for rollback)**

If all checks pass, tag the completion of 6A:

```bash
git tag phase-6a-complete
```

---

## 6A Complete — Next Sub-Phase

When 6A is done and all exit criteria pass, the next sub-phase is **6B: `@gmacko/db` schema normalization**. Before starting 6B, write its detailed plan doc at `docs/plans/2026-04-19-phase6b-db-schema.md` using the `writing-plans` skill, using the 6A plan as a template for structure.

---

# Sub-Phase Summaries for 6B–6L

Each of these gets its own detailed plan doc when picked up. These summaries are the scope envelope, not the work breakdown.

## 6B: `@gmacko/db` schema normalization

**Scope:**
- Add shared tables: `users`, `sessions`, `accounts`, `verifications`, `tenants`, `tenant_members`, `session_secrets`, `session_secret_usages`, `project_deploy_secret_bindings`, `chat_conversations`, `chat_messages`, `task_runs`, `task_run_events`, `runner_devices`, `runner_capabilities`
- Keep existing OODA-adjacent tables (`threads`, `branches`, `messages`) untouched — they move during OODA migration
- Generate a migration, apply to PGlite, verify round-trip (insert, query, select with foreign keys)
- Add `schema` subpath exports: `@gmacko/db/schema/auth`, `@gmacko/db/schema/secrets`, `@gmacko/db/schema/sessions`, `@gmacko/db/schema/runner`

**Exit criteria:**
- Fresh `drizzle-kit push` applies cleanly against empty PGlite
- All new tables have round-trip integration tests (insert → query → delete)
- `@gmacko/db` exports the new schema tables from its barrel

## 6C: `@gmacko/auth`

**Scope:**
- Install `better-auth`
- Wrap better-auth in an Effect `Service` (`AuthService`) with `login`, `logout`, `verifySession`, `currentUser` effects
- `CurrentUser` context tag (from `@gmacko/rpc/context`) gets populated by auth middleware
- Tenancy: `createTenant`, `addMember`, `requireRole` helpers against `tenants` + `tenant_members`
- GitHub OAuth provider configured
- Device flow for mobile/desktop (OAuth device code grant)
- RPC group exposed: `AuthRpc` with `Login`, `Logout`, `WhoAmI`, `StartDeviceFlow`, `CompleteDeviceFlow`

**Exit criteria:**
- better-auth login flow works end-to-end against PGlite in a test
- `requireAuth` middleware populates `CurrentUser` in RPC context
- Device flow returns a code + polling URL; completes against a mock OAuth provider in tests

## 6D: `@gmacko/secrets`

**Scope:**
- Port Bob's `sessionSecretVault.ts` (AES-256-GCM + HMAC-derived keys) — rename env var to `GMACKO_SECRET_ENCRYPTION_KEY`
- Port Bob's `sessionSecretService.ts` — rewrapped as Effect `Service` with CRUD effects
- Policy enforcement: `allowedTemplates`, `allowedArgPrefixes`, `maxUses`, `redactOutput`
- Audit writes to `session_secret_usages` on every use
- CLI-auth probes module: `checkCodexAuth()`, `checkClaudeAuth()`, `checkGhAuth()` — each returns `Effect<CliAuthStatus, never>` with `{ tool, authenticated, account?, error? }`
- MCP tool surface: an exported function that registers `secrets/*` tools against an MCP server instance
- RPC group: `SecretsRpc` — `CreateSecret`, `ListSecrets`, `DeleteSecret`, `UseSecret` (the last enforces policy + writes audit row)

**Exit criteria:**
- Round-trip encryption test passes (encrypt + decrypt arbitrary string with known key)
- Policy test: using a secret outside its `allowedArgPrefixes` fails with a specific error
- `maxUses` enforcement test: N+1th use fails
- CLI probes return correct status for a mocked `which codex` + `codex auth status` sequence

## 6E: `@gmacko/agent`

**Scope:**
- Evolve existing `packages/agent/src/dispatch.ts` into a full `AgentSession` Effect Service
- Session lifecycle: `create(config)`, `start(input)`, `stream()`, `cancel()`, `close()`
- Tool-use dispatch: multi-turn loop that handles `tool_use` and `tool_result` blocks per Anthropic's API
- Transcript persistence: every inbound/outbound turn writes rows to `chat_conversations` + `chat_messages` via `@gmacko/db`
- Adapter pattern: `ClaudeApiAdapter` (existing Anthropic SDK), `CodexCliAdapter` (node-pty spawn, reads Codex stdio protocol)
- Cancellation: calling `cancel()` aborts in-flight streaming and writes a `canceled` transcript entry
- RPC group: `AgentRpc` — `CreateSession`, `StreamSession` (SSE), `CancelSession`, `GetTranscript`

**Exit criteria:**
- A session with a single user turn → Claude mock → tool call → tool result → final response persists 4 messages in correct order
- Cancel mid-stream aborts within 1s and marks the session `canceled` in DB
- Both adapters pass the same session-contract test suite

## 6F: RPC contract surface + `@gmacko/client` SDK (inserted 2026-04-21 for OODA integration)

**Scope:**
- Wrap `resolveCurrentUser` in `RpcMiddleware.Service` (6C carryover) so contract procedures can declare `requires: [CurrentUser]`.
- Add RpcGroups for every gmacko-shared service: `AuthRpc`, `ProjectsRpc`, `SecretsRpc`, `AgentRpc` (with streaming `agent.sendTurn`).
- New `@gmacko/client` package (33rd in monorepo) — typed client SDK with per-group facades returning Promise/AsyncIterable for browser consumers.
- Stub handlers in `@gmacko/contracts/stubs/*` so OODA can hit real RPC endpoints with deterministic mock data while real handlers land in 6K.
- Legacy OODA procedures (`threads.*`, `branches.*`, `messages.*`, `exploration.*`) stay as compat surface.
- OODA integration README.

**Exit criteria:**
- OODA can `pnpm add @gmacko/contracts @gmacko/client` and write typed calls against a stub server.
- Stubs and real services must share identical Schema shapes — swapping in real implementations in 6K must not break OODA's consumer code.
- Full test suite ≥ 245 passing.

Full plan: `docs/plans/2026-04-21-phase6f-contracts.md`.

## 6G: `@gmacko/runner-protocol` + `@gmacko/runner-base`

**Scope:**
- Define Effect/Schema wire contract in `@gmacko/runner-protocol`:
  - `Register { deviceId, capabilities, authToken } → RegisterResponse { registrationId, serverTime }`
  - `Heartbeat { deviceId, status: "idle" | "busy" | "draining" } → HeartbeatResponse { serverTime }`
  - `ClaimWork { deviceId, capabilityFilter: string[] } → Option<TaskRun>`
  - `ReportEvent { runId, event: TaskRunEvent } → void`
  - `Capabilities` domain: `can_codex`, `can_claude`, `has_vault_write`, etc. as a string literal union
- `@gmacko/runner-base` provides:
  - `RunnerRuntime` Effect Service: runs the register → heartbeat → claim loop
  - `WorkHandler` registration API: products register handlers for specific capability combos
  - Retries with exponential backoff, jittered
  - Graceful shutdown (drains in-flight work before exit)

**Exit criteria:**
- Protocol round-trip test: a dummy runner registers, heartbeats 3×, claims a stub task, reports 5 events, shuts down cleanly
- Retry test: simulated transient error on heartbeat recovers within budget
- Drain test: in-flight task completes before runtime exits, even under SIGTERM

## 6H: `@gmacko/realtime`

**Scope:**
- SSE helpers for Effect-RPC streams in `@gmacko/realtime/sse` — reuses what's already in gmacko for agent chat streaming (see commit `30d11da`)
- `PubSub` interface: `publish(channel, event)`, `subscribe(channel): Stream`
- **In-memory backend** (`@gmacko/realtime/backends/memory`) — real implementation
- **Redis backend** (`@gmacko/realtime/backends/redis`) — STUB ONLY: interface implemented, throws "not implemented" on real calls; full impl deferred to when a concrete caller needs it
- **ws-gateway backend** (`@gmacko/realtime/backends/ws-gateway`) — STUB ONLY: same pattern as Redis
- Backend selection via `@gmacko/config`: `REALTIME_BACKEND=memory|redis|ws-gateway`

**Exit criteria:**
- In-memory pub/sub round-trip: publish + subscribe on the same channel receives the event
- Stub backends throw the expected error when called
- Backend is chosen by config env var

## 6I: `@gmacko/ui` theme mechanism + Bob reference theme

**Scope:**
- Theme mechanism: `data-theme` attribute on `<html>`; CSS custom properties for `--color-bg`, `--color-fg`, `--color-primary`, `--color-accent`, `--color-muted`, `--font-sans`, `--font-mono`, spacing scale, radii, shadows
- Evolve existing `theme-provider.tsx` to support multiple themes + system-preference detection
- Bob reference theme: token values lifted from Bob's DESIGN.md (amber #D4850A primary, warm gray neutrals, Satoshi + DM Sans)
- OODA reference theme: placeholder dark + gold (keep existing)
- Theme-aware updates to existing components (`button`, `input`, `chat` primitives) to consume tokens

**Exit criteria:**
- `data-theme="bob"` on `<html>` produces the amber palette (smoke-test CSS custom-property values via vitest + jsdom)
- Existing 15 `@gmacko/ui` tests still pass
- Snapshot test for a Button rendered under both themes

## 6J: `@gmacko/app-shell` (web)

**Scope:**
- Auth UI: login page, tenancy picker, device-flow entry for mobile/desktop
- Provider stack: Effect runtime provider, RPC client provider, theme provider, toast provider
- Layout primitives: `AppShell` (sidebar + header + content), `AuthedOnly` wrapper
- Error boundary that renders Effect errors cleanly
- SSR-safe: works with Next.js 16 app-router RSC + "use client" boundaries

**Exit criteria:**
- A stub Next.js app (the reference `apps/web`) renders the login page using only `@gmacko/app-shell` primitives
- Login → redirect to `/` → app-shell renders with `AuthedOnly` gate working

## 6K: Wire reference `apps/web` end-to-end

**Scope:**
- Move Effect-RPC server into `apps/web` as a Next.js route handler (`app/api/rpc/route.ts`)
- Compose all layers (auth + db + secrets + agent + runner + realtime) at the route handler
- Build a minimal UI that exercises every critical-path service:
  - Login page
  - "Start session" button → creates an `AgentSession` and streams via SSE
  - "Connected runners" panel (polls `RunnerRpc.listDevices`)
  - "Provision secret" flow for a test secret the runner consumes
  - "Transcript" view for persisted sessions
- Run a local PGlite in-process for dev

**Exit criteria:**
- `pnpm --filter @gmacko/web dev` boots and hits all the critical-path services
- End-to-end test (Playwright or similar): login → session → stream → runner → secret → transcript all work

## 6L: E2E validation + peripheral package stubs

**Scope:**
- Write a single E2E integration test that covers all §7 #2 bullet points
- Verify fresh Postgres migration applies (§7 #4)
- Verify Bob theme renders in a headless browser snapshot (§7 #3)
- For each of the 13 peripheral packages (`@gmacko/{notifications,storage,monitoring,mcp-server,email,cookies,i18n,settings,analytics,billing,agent-toolkit,mobile-shell,desktop-shell}`), define the stable public-API surface in `src/index.ts` with stub implementations that either no-op or throw `"not implemented"` with a clear message. Document the real impl as deferred to Phase 7 (Bob migration).

**Exit criteria:**
- E2E test passes against fresh state
- All 23 core packages export a stable public API
- Tag `phase-6-complete` on the branch
- Open PR `finalize-gmacko-core` against master with summary of what landed and what's deferred

---

## End of Master Plan

After this phase completes, Phase 7 (Bob migration) begins. Bob gets rewritten onto gmacko core, replacing `@bob/api`, `@bob/db`, `@bob/auth`, `@bob/agents`, `@bob/execution`, `@bob/realtime`, `@bob/ws` with their gmacko equivalents. Peripheral packages (`notifications`, `storage`, etc.) get fleshed out during Bob migration when concrete callers emerge.
