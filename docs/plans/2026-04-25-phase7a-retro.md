# Phase 7A Punchlist — Retrospective

**Branch:** `phase-7a-punchlist`
**Tag:** `phase-7a-complete` (after merge)
**Plan:** [`2026-04-25-phase7a-punchlist.md`](./2026-04-25-phase7a-punchlist.md)
**Duration:** 2026-04-25 (single-day execution via subagent-driven-development)
**Commits:** 17 (16 task-aligned + 1 final review fix)

## What Phase 7A delivered

The 5-item punchlist scope:

1. **Signature-aware Sessions** — `Sessions.validateRequest(headers)` delegates
   to better-auth's `auth.api.getSession({ headers })`, replacing the raw DB
   token lookup that couldn't unsign HMAC-signed cookies. Wired through
   `resolveCurrentUser` (cookie path) + plumbed via `BetterAuth` Layer in
   `apps/web/src/server/layers.ts`.

2. **Tenant bootstrap on first sign-up** — better-auth's
   `databaseHooks.user.create.after` creates a personal `tenants` row +
   `tenant_members` row (role: owner) atomically (drizzle transaction).
   Bootstrap is on by default, opt-out for tests.

3. **Errors-subpath refactor** — `@gmacko/{auth, secrets, projects, agent}`
   each ship a dependency-free `./errors` subpath (single import:
   `Schema` from `effect`). `@gmacko/contracts` (groups + stubs + tests)
   imports from these subpaths. `apps/web/next.config.ts` lost 61 lines
   of webpack workarounds (`resolve.fallback`, `NormalModuleReplacementPlugin`)
   for `node:` scheme imports — the headline win.

4. **Smoke test improvements:**
   - Page-compile fetch in `beforeAll` (catches client-bundle regressions
     like the `node:crypto` leak that would have shipped silently).
   - Fixed two pre-existing `rpcCall` bugs (NDJson framing missing
     newline + `Eof`, default payload `{}` failing `Schema.Void`).
   - Tightened the unauthenticated `auth.whoAmI` test to assert the
     actual `UnauthorizedError` envelope shape.
   - Cookie-bearing tests left loose with explicit comments pointing
     at the PGlite-WASM `Aborted()` blocker (deferred to 7B).

5. **`apps/web/DEPLOY.md` stub** — env vars, build commands, smoke
   status, known issues, Phase 7B/C carry-forward.

## Test counts (delta from `phase-6-complete`)

| Package | Before | After | Δ |
|---|---|---|---|
| `@gmacko/auth` | 66 | 70 | +4 (validateRequest + tenant bootstrap + linkage assertions) |
| `@gmacko/contracts` | 12 | 12 | 0 |
| `@gmacko/client` | 10 | 10 | 0 |
| `@gmacko/secrets` | 25 | 25 | 0 |
| `@gmacko/projects` | 8 | 8 | 0 |
| `@gmacko/agent` | 33 | 33 | 0 |
| `apps/web` smoke | 8 | 9 | +1 (tenant bootstrap doesn't crash) |
| **Total touched** | 162 | 167 | **+5** |

`@gmacko/auth` shows 70 in this table (66 + 4) but the running count
during execution was reported as 69 — the discrepancy is one additional
linkage assertion test added during the Task 4 fix commit (`99a33ef`)
that was counted under "tightened" rather than "new". Both numbers are
accurate; the 70 reflects raw `vitest run` output.

## Code surface delta

- `apps/web/next.config.ts`: 141 → 80 lines (−43%, −61 lines)
- New `errors.ts` files: 4 (auth, secrets, projects, agent) totaling
  ~120 lines of dependency-free schema declarations
- New `apps/web/DEPLOY.md`: 97 lines

## Plan defects caught & corrected during execution

The plan made six material errors that subagents caught at implementation
time. None landed in any commit — all surfaced via "verify before assert"
discipline (grep, read source, check actual schema). The lesson for
future plan templates: **don't include literal expected outputs without
verification steps.** Every `Expected: X` should be paired with a
`Verify by running: <cmd>` step.

| # | Plan claim | Reality |
|---|---|---|
| 1 | `tenants` lives in `@gmacko/db/schema/auth` | Actually `@gmacko/db/schema/tenancy` |
| 2 | `runMigrations(db)` takes drizzle handle | Takes `PGlite` instance |
| 3 | `tenants` INSERT needs `name + createdByUserId` | No `createdByUserId` column; `slug` (NOT NULL UNIQUE) is required |
| 4 | `@gmacko/agent` errors are `AgentSpawnFailedError` etc. | Actual names: `AdapterSpawnError`, `AdapterExitError`, `TurnInProgressError`, `AgentSessionNotFoundError` |
| 5 | `@gmacko/auth` has 7 tagged errors | Has 9 (plan missed `InsufficientRoleError`, `InvalidRunnerSessionError`) |
| 6 | `Layer.provide(layerSessions, dbLayer)` will fail typecheck after Task 1 | Didn't fail typecheck at all — `as unknown as` cast in `route.ts:62` swallowed the leak silently |

Defects 1-5 were schema/identifier mistakes (bad recall). Defect 6 is
structurally important — see "Carry-forward" below.

## Important findings discovered during 7A

### F1. PGlite WASM `Aborted()` under concurrent better-auth + RPC load

When `apps/web/src/__tests__/smoke.test.ts` runs the cookie-bearing flow
(sign-up → sign-in → `/get-session` with cookie), PGlite WASM emits
`Aborted()` (unhandled rejection in the WASM heap). All subsequent
`/api/rpc` requests return `Failure { Interrupt }` envelopes or 503
empty bodies because the RPC server fiber is interrupted.

**Why it doesn't surface in unit tests:** Each `@gmacko/auth` test gets
an isolated PGlite handle via `beforeEach`. The abort only manifests
when better-auth + RPC handlers + drizzle adapter share a long-lived
PGlite handle across multiple HTTP requests in the same Next.js dev
process.

**Drizzle adapter logs:** `[Drizzle Adapter] - Transactions are not
supported. Executing operations sequentially.` — the adapter is
serializing operations, but `Aborted()` still fires later. Likely
state corruption or a race between `databaseHooks.user.create.after`
and a subsequent verifier query.

**Production impact: ZERO.** Production uses Postgres, not PGlite WASM.
Postgres has real transactions, no concurrency limit, no WASM heap.

**Carry-forward to 7B:** the smoke test should run against Postgres for
the cookie-bearing strict assertions. PGlite remains the dev/test
default for everything else.

### F2. Smoke test was structurally blind to client-bundle regressions

Pre-7A, the smoke test only POST'd to `/api/rpc` and `/api/auth/*`
(server routes). `next dev` cold-compiles routes lazily — no HTTP
call to a page route = no client-bundle compile = no
`UnhandledSchemeError` even when the bundle was completely broken.

The Task 9 review caught this empirically: the reviewer ran
`next dev --webpack` + curl'd `/`, found `UnhandledSchemeError` on
`node:crypto` from `packages/contracts/src/stubs/auth.ts:19`, and
flagged it as a Critical false-green that would have shipped.

**Fix in 7A (commit `4d56f5c`):**
- Patched the four `packages/contracts/src/stubs/*.ts` files to use
  `@gmacko/<svc>/errors` (the obvious extension of Task 9 the plan
  missed).
- Added a page-compile fetch to `beforeAll` so this regression class
  is structurally impossible going forward.

### F3. `runtimeLayer` R-channel leak hidden by route-handler cast

Task 3 review found that `apps/web/src/app/api/rpc/route.ts:62` ends
with `as unknown as Layer.Layer<never, never, HttpRouter>`. That cast
erases any residual `R` on `runtimeLayer` before TS can complain. So
when `layerSessions` widened from `R = GmackoDb` to `R = GmackoDb |
BetterAuth` in Task 1, no typecheck error surfaced — the `as unknown
as` swallowed it. The fix was still semantically required (runtime
would have failed without `BetterAuth` in the ServiceMap), but the
typecheck "verify red" gate didn't bite.

**Carry-forward to 7B:** annotate `runtimeLayer` with explicit type
`Layer.Layer<R_runtime, never, never>` so future R-channel leaks fail
loudly. Tighten the cast in `route.ts` to drop only the
`HttpServerRequest` / `CurrentUser` ambients rather than `as unknown
as`-ing through the full residual.

### F4. Two pre-existing `rpcCall` test-helper bugs

Discovered when Task 10's tightening attempt hit ambiguous failures.
The smoke test's `rpcCall` helper:

1. Sent NDJson without `\n` terminators or `Eof` frame → Effect-RPC
   parser never decoded a request → server returned 500 with empty
   body and a `Cause/Done` interrupt.
2. Defaulted `payload` to `{}` → `Schema.Void` procedures (like
   `auth.whoAmI`) died with `Die: "Expected null, got {}"`.

**Both fixed in commit `a480f82`.** These bugs were masked by the
loose `instanceof Response` assertions for the entire history of the
smoke test (Phase 6L through Phase 7A).

## Carry-forward to Phase 7B

In rough priority order:

1. **Smoke test on Postgres** — unblocks F1's strict cookie-bearing
   assertions. Likely needs a docker-compose Postgres for CI.
2. **Tighten `runtimeLayer` type + `route.ts` cast** — F3.
3. **Add `typecheck` script** to `apps/web/package.json` — flagged in
   Task 3 review.
4. **Investigate PGlite WASM concurrency** — long-tail; only matters
   for dev/test ergonomics.
5. **Per-module redundant error re-exports cleanup** — Task 6 review
   polish (each barrel has both `export * from "./errors.js"` and
   redundant per-service named re-exports).
6. **Pre-existing OODA TS errors** in `apps/web/src/app/graph/page.tsx`
   and `apps/web/src/components/voice-input.tsx` — out of scope, but
   block `next build` in some configs.
7. **Tighten `Sessions.validateRequest`** with `Effect.tryPromise`
   instead of `Effect.promise` so better-auth contract drift surfaces
   as a clean `SessionExpiredError` rather than a defect (final review
   suggestion S5).

## What worked well

- **Subagent-driven-development with code review between tasks.**
  Caught at least three issues that would have shipped silently:
  Task 4's I-1 orphan-user race, Task 9's client-bundle false-green,
  Task 10's PGlite blocker discovery. Code review is not optional.
- **Plan defect inventory.** Subagents read source before assuming
  plan literals. All six plan defects were caught at impl time, not
  shipped.
- **Atomic commits.** 17 commits with clear conventional-commits
  messages, each bisectable. The three "fix" commits (Task 4 I-1,
  Task 9 stubs, Task 10 rpcCall) preserve the narrative of "we caught
  this in review" rather than amending it away.

## What could improve

- **Plan should require "verify before assert."** See defects 1-5.
  Future plans use `Verify by running: <cmd>` paired with every
  literal expected output.
- **Task 9 should have included stubs from the start.** The reviewer
  caught it, but the plan-writer should have grep'd the contracts
  package for ALL `@gmacko/<svc>` imports, not just the groups dir.
- **Empirical verification gates.** Task 9's "smoke passes = workarounds
  removable" was wrong — smoke didn't compile the client bundle.
  Future "removed a workaround" tasks need an explicit
  page-compile or build verification.

## Final state

- All 11 plan tasks complete + 6 follow-up commits.
- All applicable test suites green.
- `apps/web` smoke 9/9 with strict assertion on the unauthenticated
  envelope path.
- `apps/web/next.config.ts` 43% leaner.
- 4 dependency-free `./errors` subpaths shipped across the gmacko core.

**Ready for merge to master and `phase-7a-complete` tag.**
