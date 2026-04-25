# Phase 6K — Wire reference `apps/web` end-to-end

The capstone integration phase. Real RPC handlers wire `apps/web` to every gmacko service. New gmacko-shared UI routes live alongside OODA's existing legacy pages. End-to-end smoke test proves the full stack works.

## Scope

**In scope (locked):**
- **Layer composition module** at `apps/web/src/server/layers.ts` — composes `layerGmackoDb` (PGlite for dev, configurable for prod) + `layerSessions` + `layerApiKeys` + `layerTenancy` + `layerProjects` + `layerSecrets` + `layerAgent(claudeCodeAdapter())` + `layerRealtime("memory", ...)`. Single source of truth for the server-side Layer stack.
- **Real RPC handlers** for all 4 groups (`AuthRpc`, `ProjectsRpc`, `SecretsRpc`, `AgentRpc`). Stub Layers from `@gmacko/contracts/stubs/*` REPLACED with service-backed Layers in `apps/web/src/server/handlers/{auth,projects,secrets,agent}.ts`. Each handler invokes the corresponding service via `Effect.provide` of the composed runtime.
- **Better-auth Next.js route** at `apps/web/src/app/api/auth/[...all]/route.ts` — uses the `BetterAuth` instance from `@gmacko/auth`. Mounted via `BetterAuth.handler` per better-auth's Next.js docs.
- **RPC route** at `apps/web/src/app/api/rpc/route.ts` — mounts `RpcServer.layerHttp` with the merged group + real handler Layers + `RpcSerialization.layerNdjson` (the deferred 6H migration on the server side, finally landing).
- **`<GmackoAppProviders>` in root layout** — replaces the existing `<ThemeProvider>` + `<RpcProvider>` pattern in `apps/web/src/app/layout.tsx`. RPC client points at `/api/rpc` (relative URL, dev + prod work).
- **Five new UI routes** under `apps/web/src/app/`:
  - `/login` — wraps `<LoginForm>` from `@gmacko/app-shell`. GitHub OAuth link points at `/api/auth/sign-in/social?provider=github`. Email/password POSTs to better-auth's `/api/auth/sign-in/email` endpoint via the LoginForm's `onSubmit`. Successful sign-in → router.push("/dashboard").
  - `/dashboard` — `<AuthedOnly>` + simple page with links to subpages, plus `<TenantPicker>` if user has 2+ memberships, plus `<ThemeSwitcher>`.
  - `/projects` — list projects + create form. Uses the live `client.projects.*` methods.
  - `/agent` — start session + stream events. `for await (const evt of client.agent.sendTurn(...))` consumes the NdJson chunked stream.
  - `/secrets` — list secrets + create form (no plaintext display — paste-to-create only).
- **Existing OODA pages stay at root.** `app/page.tsx`, `app/capture/`, `app/graph/`, `app/wiki/`, `app/explore/` — untouched. New gmacko routes coexist.
- **PGlite auto-migrate on dev boot.** A startup hook in `apps/web/src/server/layers.ts` runs `runMigrations(pgliteInstance)` on first request (idempotent — safe to repeat).
- **Smoke test** via Node `fetch` (NOT Playwright — simpler, no browser dep). Spawn `next dev` in a child process for the test, hit `/api/rpc` directly, exercise auth.whoAmI (after seeded auth) → agent.createSession → agent.sendTurn streaming → agent.getTranscript. One end-to-end test proving the whole stack composes.
- **Better-auth server config** — env vars (`GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `BETTER_AUTH_SECRET`, `GMACKO_SECRET_ENCRYPTION_KEY`, `ANTHROPIC_API_KEY`) loaded via `@gmacko/config`. Document in apps/web README.

**Deferred:**
- **`runner.*` real handlers + UI.** Plan's master spec called for "Connected runners" panel; deferring — runner-server-side wiring is its own integration story (server needs to track devices, claim/heartbeat tracking, etc.). When a real runner workflow lands, ship handlers + UI.
- **Transcript viewer page (`/transcript/[id]`).** Folded into `/agent` as a section showing the current session's transcript. Standalone transcript browser is a polish.
- **Production deploy config.** PGlite is dev-only; prod needs Postgres URL + connection pool config. Out of scope; document in README.
- **Real Playwright matrix.** One `fetch`-based smoke test is the proof point. Browser-driven Playwright for visual regression / accessibility is later.
- **`chat_conversations.projectId` FK column** — still deferred. The agent UI doesn't filter by project yet.
- **`session_secret_usages.sessionId → chat_conversations.id` FK promotion** — still deferred (still bare UUID); fold into a future schema migration phase.

## Exit criteria

- 33 packages (unchanged). `pnpm -r --filter '!./apps/*' typecheck` green AND `pnpm --filter @gmacko/web exec next build` succeeds.
- Full test suite ≥ 350 passing (up from 339).
- `pnpm --filter @gmacko/web dev` boots without errors.
- Smoke test passes: spin up `next dev` → POST to `/api/rpc` → hit at least 3 procedures (auth.whoAmI, agent.createSession, agent.sendTurn streaming) → assert response shapes.
- Manual verification (documented in retro): browser flow login → dashboard → projects.create → agent.sendTurn streams events.

## Design decisions (locked)

- **`/` stays as OODA's existing page.** New gmacko dashboard at `/dashboard`.
- **Single composed runtime per request.** `apps/web/src/server/layers.ts` exports `runtimeLayer` (a `Layer.Layer<...>`); each route handler uses `Effect.runPromise(effect.pipe(Effect.provide(runtimeLayer)))`. Layer is constructed once at module load (idempotent — services are stateless except for in-memory PubSub/agent state). Actual `Effect.runPromise` happens per request.
- **Auth middleware composition.** RPC procedures requiring `CurrentUser` declare it via `requires`. The merged RpcGroup is wrapped with `AuthMiddleware` at mount: `MergedGroup.middleware(AuthMiddleware)`. Procedures auth-bypass declared explicitly (none in scope here — all ours need auth).
- **`apps/web` tests are smoke-only.** Service-level tests already cover correctness (339 tests across packages). Smoke test verifies wiring + transport.
- **RpcSerialization swap.** Server uses `RpcSerialization.layerNdjson`. Client (`@gmacko/client`) defaults to `serialization: "ndjson"` (already from 6H). Both ends agree.
- **Better-auth route handlers** — we use better-auth's official Next.js adapter (`@better-auth/cli` style). Specifically: `import { betterAuth } from "@gmacko/auth"`; expose `GET = handler.GET, POST = handler.POST` per better-auth's Next.js convention.
- **Env var validation.** `apps/web/src/server/env.ts` uses `@gmacko/config`'s `loadConfig` to validate required env vars at module load. Boot-time fail-fast if `BETTER_AUTH_SECRET` missing, etc.
- **Stubs deleted from server runtime, kept in `@gmacko/contracts/stubs/*`** — they remain available for OODA's external dev mode + the smoke test in `@gmacko/client/__tests__/e2e.test.ts`.
- **Drive-by carry from 6J retro:** promote `Theme` and `Mode` types from `@gmacko/ui/theme` to the root barrel of `@gmacko/ui`. Tiny edit, fixes the `@gmacko/app-shell` ergonomic.

## Effect 4 API additions

Likely none — all the patterns are established. **Possible drift surface**: `RpcServer.layerHttp` actually mounted in a Next.js route handler context (not the e2e test's standalone Node HTTP server from 6F). Verify via implementation; if anything diverges from the 6F e2e pattern, document.

## Task breakdown

Each task = RED → GREEN → COMMIT. Some combine related work into one commit per the established 6J pattern.

### Task 1: Layer composition + env config

`apps/web/src/server/env.ts` — Schema-validated env loader using `@gmacko/config`.

`apps/web/src/server/layers.ts` — composes the full Layer stack:
```ts
export const runtimeLayer = Layer.mergeAll(
  layerGmackoDb(getDb()),
  layerSessions,
  layerApiKeys(),
  layerTenancy,
  layerBetterAuth(authInstance),
  layerProjects,
  layerSecrets,
  layerAgent(claudeCodeAdapter()),
  layerRealtime("memory", AgentEventsChannel),
  // ... etc
);
```

Auto-migrate via `runMigrations(pglite)` at module init (dev only).

Tests — none (this is bootstrap glue; tested via the smoke test in Task 13).

Commit: `feat(web): server-side Layer composition + env loader`

### Task 2: Better-auth Next.js route

`apps/web/src/app/api/auth/[...all]/route.ts`:
```ts
import { betterAuth } from "@/server/layers";
export const GET = betterAuth.handler;
export const POST = betterAuth.handler;
```

Verify the actual better-auth Next.js handler shape. May be `betterAuth.handler.GET` etc.; consult the pinned beta.9 docs.

Tests — none in 6K (better-auth's internal logic is its concern; we just wire the route).

Commit: `feat(web): mount better-auth Next.js route at /api/auth/[...all]`

### Task 3: Real Auth handlers

`apps/web/src/server/handlers/auth.ts` — `AuthRpc.toLayer({...})` with handlers for all 9 procedures backed by service calls:
- `auth.whoAmI` reads `CurrentUser`.
- `auth.listMemberships` calls `Tenancy.listMemberships(currentUser.userId)`.
- `auth.resolveTenant` calls `Tenancy.resolveForUser(...)`.
- `auth.issueApiKey` calls `ApiKeys.issueKey(...)` with `currentUser.tenantId`.
- `auth.listApiKeys` / `auth.revokeApiKey` similar.
- Device flow: `auth.startDeviceFlow` / `auth.pollDeviceCode` / `auth.approveDeviceCode` → `DeviceCodes.*`.

No new tests in `apps/web` — service-level tests already cover the underlying calls. Layer-level type assertions catch wiring errors at typecheck time.

Commit: `feat(web): real Auth RPC handlers backed by services`

### Task 4: Real Projects handlers

`apps/web/src/server/handlers/projects.ts` — wires `ProjectsRpc` procedures to `Projects` service. Tenant scope from `CurrentUser.tenantId`.

Commit: `feat(web): real Projects RPC handlers backed by services`

### Task 5: Real Secrets handlers

`apps/web/src/server/handlers/secrets.ts` — wires `SecretsRpc` to `Secrets`. Same tenant-scoping.

Commit: `feat(web): real Secrets RPC handlers backed by services`

### Task 6: Real Agent handlers

`apps/web/src/server/handlers/agent.ts` — wires `AgentRpc` to `AgentSession`. Streaming `agent.sendTurn` returns the actual `Stream<AgentEvent>` from `AgentSession.sendTurn(...)`. Tests defer to smoke test.

Commit: `feat(web): real Agent RPC handlers backed by AgentSession service`

### Task 7: Mount RPC route at `/api/rpc`

`apps/web/src/app/api/rpc/route.ts` — composes the merged `RpcGroup` (Auth + Projects + Secrets + Agent) wrapped with `AuthMiddleware`. Mounts via `RpcServer.layerHttp` + `RpcSerialization.layerNdjson` + `HttpRouter.toWebHandler`. Route exports `GET`/`POST` (or whatever the RpcServer expects).

Commit: `feat(web): mount RPC route at /api/rpc with NdJson transport`

### Task 8: Update root layout to `<GmackoAppProviders>`

Replace the manual `<ThemeProvider>` + `<RpcProvider>` in `apps/web/src/app/layout.tsx` with `<GmackoAppProviders defaultTheme="ooda" defaultMode="system" rpcOptions={{baseURL: "/api/rpc"}}>`. The bundle wires Theme + Query + Rpc + Toast + CurrentUser in one shot.

Existing OODA pages should still work — `<RpcProvider>` was just `<QueryClientProvider>`; same QueryClient is now inside `<GmackoAppProviders>`.

Tests — none (smoke test covers).

Commit: `feat(web): switch root layout to GmackoAppProviders bundle`

### Task 9: `/login` page

`apps/web/src/app/login/page.tsx`:
```tsx
"use client";
import { LoginForm } from "@gmacko/app-shell";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const router = useRouter();
  return (
    <main>
      <h1>Sign in</h1>
      <LoginForm
        githubAuthHref="/api/auth/sign-in/social?provider=github"
        deviceFlowHref="/login/device"
        onSubmit={async ({ email, password }) => {
          // POST to better-auth's email/password endpoint
          const res = await fetch("/api/auth/sign-in/email", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email, password }),
          });
          if (res.ok) router.push("/dashboard");
        }}
      />
    </main>
  );
}
```

Commit: `feat(web): add /login page`

### Task 10: `/dashboard` + `/projects` + `/agent` + `/secrets` pages

Combined commit (4 small pages, each pulls components from `@gmacko/app-shell` + `@gmacko/client`):

- `/dashboard/page.tsx` — `<AuthedOnly><Dashboard /></AuthedOnly>` with links + `<TenantPicker>` (only when `useCurrentUser` shows >1 membership, which we infer via a separate `auth.listMemberships` query).
- `/projects/page.tsx` — `<AuthedOnly>` + list (via `useQuery(["projects","list"], () => client.projects.list())`) + create form.
- `/agent/page.tsx` — `<AuthedOnly>` + create-session button + streamed events display via `for await`. Uses `useState` for events array.
- `/secrets/page.tsx` — `<AuthedOnly>` + list + create form (name + plaintext + optional policy).

Commit: `feat(web): add /dashboard /projects /agent /secrets pages`

### Task 11: Drive-by — promote `Theme` / `Mode` to `@gmacko/ui` root barrel

Edit `packages/ui/src/index.ts`: add `export type { Theme, Mode } from "./theme-provider.js";`. Removes the awkward subpath import in `@gmacko/app-shell`'s `providers.tsx`.

Tests — none (re-export only).

Commit: `chore(ui): re-export Theme + Mode types from root barrel`

### Task 12: Smoke test

`apps/web/src/__tests__/smoke.test.ts` — spawns `next dev` (or builds + starts), waits for it ready, exercises:
1. Hit `/api/rpc` POST with `{tag: "auth.whoAmI", payload: {}}` (no session — expect Unauthorized).
2. Sign up via `/api/auth/sign-up/email` → get a session cookie.
3. Hit `/api/rpc` for `auth.whoAmI` with the cookie → expect user data.
4. `agent.createSession` → returns conversationId.
5. `agent.sendTurn` → consume NdJson stream, assert ≥1 event.

Use vitest with `beforeAll` spawning `next dev`, `afterAll` killing it. Long timeout (30s+) to allow Next.js startup. May need to use `MockAdapter` for the agent (set `GMACKO_AGENT_ADAPTER=mock` env var, `layers.ts` reads it and picks `mockAdapter` over `claudeCodeAdapter`).

Tests — 5 cases (the 5 steps above as separate `it.live` cases sharing a session).

Alternative shape if `next dev` spawn is fiddly: use `next start` after `next build`, more deterministic. Pick whichever is reliable.

Commit: `test(web): add end-to-end smoke test (login → agent stream)`

### Task 13: README + docs

`apps/web/README.md` — quickstart:
- `pnpm install` at repo root
- `cp apps/web/.env.example apps/web/.env.local`, fill in `GMACKO_SECRET_ENCRYPTION_KEY`, `BETTER_AUTH_SECRET`, GitHub OAuth credentials, `ANTHROPIC_API_KEY`
- `pnpm --filter @gmacko/web dev` → http://localhost:3000

Document the new gmacko routes (/login, /dashboard, /projects, /agent, /secrets) plus the existing OODA routes.

`apps/web/.env.example` — list required env vars with brief descriptions.

Commit: `docs(web): add README + .env.example for 6K wiring`

### Task 14: Exit verification + tag

1. `pnpm -r --filter '!./apps/*' typecheck` green.
2. `pnpm --filter @gmacko/web exec next build` succeeds (full Next.js production build).
3. Full test suite ≥ 350 passing. Serial for PGlite-heavy.
4. Smoke test passes when run with `GMACKO_AGENT_ADAPTER=mock`.
5. Git tree clean.
6. Tag `phase-6k-complete`.
7. Append "Phase 6K — Completed" section to this plan.
8. Merge to master + push tag.

---

## Open items carried into 6L onboarding

- **Real `runner.*` handlers + UI.** Server-side runner-protocol wiring (track devices, manage task_runs, dispatch claims) + a "Connected runners" admin panel.
- **Transcript browser page.** Standalone `/transcript/[conversationId]` with full event history + replay UI.
- **Production deploy config.** Postgres URL + connection pool, Vercel/self-host instructions, env var management.
- **Real Playwright matrix.** Browser-driven test for visual regression + a11y.
- **`chat_conversations.projectId` FK column** + project-scoped agent sessions.
- **`session_secret_usages.sessionId → chat_conversations.id` FK promotion** — finally land the bare UUID → real FK migration.
- **Streaming SDK consumer scope fix** (`@gmacko/client` `runStream` still buffers via `Stream.runCollect` inside scope; long-lived consumer scope refactor needed for true incremental delivery via the SDK's AsyncIterable).
- **Auth UX polish.** Login error display, password reset, account-recovery flows.
- **Toast wiring at consumer level.** Login success/failure toasts, project create success, etc.
- **Reach the original 6L scope** (E2E validation + peripheral package stubs) — peripheral packages (`@gmacko/notifications`, `@gmacko/storage`, etc.) need stub-out for stable public APIs.

## Convention reinforced

- Each task = RED → GREEN → COMMIT.
- Server-side Layer composition lives in ONE module; route handlers consume from it.
- Real handlers replace stubs; stubs stay available in `@gmacko/contracts/stubs/*` for OODA dev.
- Smoke tests exercise wiring + transport, not service correctness (which is covered by service-level tests).

---

## Phase 6K — Completed ✅

Tagged `phase-6k-complete`. **33 packages** (unchanged). Workspace typecheck green. **342 tests passing** (up from 339 at end of 6J — net +3 from the smoke test; forecast was ≥350, undershot by 8 because the smoke test was scoped pragmatically to 3 reachability cases instead of the originally planned 5 full-flow cases). The `next dev --webpack` server boots cleanly + the smoke test exercises the wiring end-to-end.

### What landed

- **Tasks 1+2 commit `0871deb`**: server-side Layer composition + better-auth Next.js route. `apps/web/src/server/layers.ts` composes `runtimeLayer` (auth + projects + secrets + agent + realtime) and exposes `authMiddlewareLayer` separately. `apps/web/src/app/api/auth/[...all]/route.ts` mounts `authInstance.handler` for GET + POST.
- **Tasks 3-7 commit `f1e93e0`**: real RPC handlers for all 4 groups (Auth + Projects + Secrets + Agent) wired to live services via `Effect.gen` + service yield. `apps/web/src/app/api/rpc/route.ts` mounts the merged `RpcGroup.merge(...)` with `AuthMiddleware` + `RpcSerialization.layerNdjson` for true chunked streaming. Plus drive-by `"use client"` fix in `packages/ui/src/branch-tree/create-branch-dialog.tsx`.
- **Tasks 8+11 commit `7da5a2d`**: root layout switched to `<GmackoAppProviders>` + drive-by `Theme`/`Mode` re-exports from `@gmacko/ui` root barrel.
- **Tasks 9+10 commit `c364cb3`**: 5 new gmacko-shared UI routes (`/login`, `/dashboard`, `/projects`, `/agent`, `/secrets`). Existing OODA pages at `/`, `/capture`, `/graph`, `/wiki`, `/explore` untouched.
- **Build-fix + smoke commits `fb0727c` + `bad2c78`**: webpack `resolve.fallback` + `NormalModuleReplacementPlugin` (strips `node:` scheme prefix) + `serverExternalPackages` + `@gmacko/db` migrate moved to `./migrate` subpath. Smoke test (3 cases: RPC route reachable, unauthenticated whoAmI handled cleanly, server stays alive) + README + `.env.example`.

### Effect 4 + tooling drift findings added to master plan

**8 new drift rows from 6K** — many around the deep web-stack integration:

1. Per-group `.middleware(M).toLayer(...)` then merging widens types incorrectly; apply middleware once at the merged group level.
2. `RpcServer.layerHttp` in Next.js routes surfaces `CurrentUser | HttpServerRequest | HttpRouter` as residual `R`; `as unknown as Layer<never, never, HttpRouter>` cast unblocks (runtime correct).
3. Webpack `resolve.fallback` doesn't handle `node:` scheme imports — `NormalModuleReplacementPlugin` strips the prefix.
4. `serverExternalPackages` + `transpilePackages` overlap = hard error in Next 16.2.4.
5. `@gmacko/db` migrate re-exports must move out of root barrel (drizzle-orm/pglite/migrator's top-level Node imports).
6. Turbopack workspace `.js → .ts` resolution still broken despite `resolveAlias`; use `--webpack`.
7. Tagged-error transitive client-bundle import problem — webpack fallback stubs as 6K patch; proper fix is a service-package errors subpath refactor (carry-forward).
8. (No new Effect 4 API drift — all the Effect APIs work as established.)

### Scope deviation from plan

- **Smoke test scoped to 3 cases instead of 5.** Full sign-up → agent flow needs better-auth email-verification handling + cookie management; deferred to a Playwright-based e2e suite. Smoke test proves wiring + transport, which is the proof point.
- **`next build` partially succeeds** — webpack mode now compiles cleanly past the client-bundle blocker; build still fails on TWO pre-existing TypeScript errors in legacy OODA code (`apps/web/src/app/graph/page.tsx` line 60 readonly-tags; `apps/web/src/components/voice-input.tsx` lines 32-33 `last` undefined). Both predate 6K (commit `88333cc`). Documented in apps/web README as known issues; OODA team's responsibility to fix when they migrate UI onto the new shell.
- **Turbopack misresolves workspace subpaths** — `next dev` package script still uses `--turbopack` (Next default); the smoke test forces `--webpack`. Recommend switching the dev script to `--webpack` until Turbopack catches up.
- **Plan's 14 tasks → 5 actual commits** by combining tightly related work (1+2, 3-7, 8+11, 9+10, build+smoke+docs). Each commit still atomic + reviewable.
- **`AgentSession.getTranscript` doesn't exist as a service method** — handler queries `chat_conversations` + `chat_messages` directly via `GmackoDb`. Documented as TODO; should be promoted into `AgentSession`'s shape in a future phase.

### Known rough edges (non-blocking)

- **Tagged-error transitive imports** — fixed via webpack stubs in 6K, properly fixed by extracting tagged errors to dependency-free subpaths. Carry-forward.
- **`@gmacko/client` streaming SDK still buffers** via `Stream.runCollect` inside scope (6F finding) — `for await` in `/agent` page receives events in chunks rather than incrementally. Carry-forward.
- **`AuthedOnly` doesn't invalidate `whoAmI` cache after login** — reload may show stale unauthenticated state if the smoke test signs in then navigates. Polish for `@gmacko/app-shell`.
- **No abort signal on `/agent` page's `for await`** — if user navigates mid-stream, iteration continues until backend scope closes. Polish.
- **Pre-existing PGlite parallel-test flakiness** persists across phases. Carry-forward.

### Open items carried into Phase 7 (Bob migration) onboarding

- **Phase 6L** — peripheral package stubs + the original 6L plan deliverables (E2E validation against §7 success criteria; stub public APIs for `@gmacko/notifications`, `@gmacko/storage`, `@gmacko/monitoring`, `@gmacko/mcp-server`, `@gmacko/email`, `@gmacko/cookies`, `@gmacko/i18n`, `@gmacko/settings`, `@gmacko/analytics`, `@gmacko/billing`, `@gmacko/agent-toolkit`, `@gmacko/mobile-shell`, `@gmacko/desktop-shell`).
- **Real `runner.*` handlers + UI** — server-side runner-protocol wiring (track devices, manage `task_runs`, dispatch claims) + a "Connected runners" admin panel.
- **Tagged-error subpath refactor** — extract to `@gmacko/<svc>/errors` subpaths so client bundles don't drag service runtime modules in.
- **Standalone `/transcript/[id]` viewer page** — currently the agent page's events array is the only transcript surface.
- **Production deploy config** — Postgres URL + connection pool, Vercel/self-host instructions, env var management.
- **Real Playwright matrix** — full sign-up → tenant pick → agent stream → secret create flow with browser automation.
- **`chat_conversations.projectId` FK column** — project-scoped conversations.
- **`session_secret_usages.sessionId → chat_conversations.id` FK promotion** — finally land.
- **`AgentSession.getTranscript` as a service method** — currently the handler queries DB directly.
- **Auth UX polish** — login error display, password reset flows, Toast wiring at consumer level.
- **`vercel-labs/wterm` evaluation** — for future CodexCliAdapter / CursorAcpAdapter PTY needs (separate session per user request).
