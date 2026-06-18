# Phase 6F — RPC contract surface + client SDK

Ship a stable, strongly-typed RPC contract surface so OODA can code against real Schema types + a typed client SDK while gmacko back-fills runner/realtime/UI underneath. Key inversion of the original master-plan order — **contracts land before the services that back them are fully wired** because OODA's integration timeline demands a stable type contract now.

**Phase-letter shift.** The original "6F: runner-protocol" becomes 6G; 6G→6H; 6H→6I; 6I→6J; 6J→6K; 6K→6L. The master plan's sub-phase roadmap gets a small renumbering commit.

## Scope

**In scope (locked):**
- **Master plan renumber.** Update `docs/plans/2026-04-19-phase6-core-finalization.md` sub-phase roadmap so the new 6F slots in correctly. Single commit, zero behavior change.
- **Inventory of gmacko-shared service surface** worth exposing to OODA. Per service, enumerate the procedures we want in the contract.
- **AuthMiddleware.Service wrap** — carry over from 6C. `packages/auth/src/middleware.ts`'s plain-function `resolveCurrentUser` gets wrapped in `RpcMiddleware.Service<AuthMiddleware, Config>()` so contract procedures can declare `requires: [CurrentUser]`. Plain-function path stays alongside for non-RPC callers.
- **New contract groups** added to `packages/contracts/src/groups/`:
  - `AuthRpc` — auth + tenancy + api-keys + device flow
  - `ProjectsRpc` — project CRUD
  - `SecretsRpc` — secret CRUD + decryptForUse + markSecretUsed
  - `AgentRpc` — agent session create/sendTurn(streaming)/cancel/close/getTranscript
- **New `@gmacko/client` package (33rd in monorepo)** — typed client SDK. Exports `createGmackoRpcClient({ baseURL, fetch? })` returning a client with `.auth.*`, `.projects.*`, `.secrets.*`, `.agent.*` method surfaces.
- **Stub server handlers** as `@gmacko/contracts/stubs/*` subpath — deterministic in-memory implementations returning plausible mock data. OODA mounts via `RpcServer.layerHttp({ group, handlers: layerStubHandlers })` in their dev environment.
- **End-to-end smoke test** — stub server + client round-trip for one procedure per group, proving the transport wires up.
- **OODA integration README** — `docs/ooda-integration.md` with setup instructions, example code, and a mapping of stubbed vs real procedures.

**Deferred (carries over):**
- Actual service-backed handler implementations — 6J app wiring. Stubs ship now; real implementations swap under the same contracts.
- SSE transport for streaming procedures — the streaming procedure is DECLARED in 6F; the server-side SSE wiring is 6J.
- The existing OODA-flavored procedures (`threads.*`, `branches.*`, `messages.*`, `wiki.*`, `exploration.*`) — **kept as-is**. They're legacy OODA-compat surface from before the gmacko migration; OODA migrates off them incrementally as product shape converges on the new gmacko services.
- Session token / cookie forwarding in `@gmacko/client` — scaffolded but real auth bootstrapping lands in 6J.

## Exit criteria

- **33 packages** (added `@gmacko/client`). `pnpm -r typecheck` green.
- Full test suite ≥ 245 passing (up from 222). Breakdown:
  - Baseline 6E: 222
  - Task 1 (master plan renumber): 0
  - Task 2 (AuthMiddleware.Service wrap): +3
  - Task 3 (Auth contracts + stubs): +3
  - Task 4 (Projects contracts + stubs): +2
  - Task 5 (Secrets contracts + stubs): +3
  - Task 6 (Agent contracts + stubs, incl. streaming): +4
  - Task 7 (@gmacko/client scaffold): +1
  - Task 8 (client SDK composition per group): +4
  - Task 9 (end-to-end smoke test): +3
  - Task 10 (OODA integration README): 0
  - **Expected total: ~245** (meeting floor).
- OODA can `pnpm add @gmacko/client @gmacko/contracts` in their repo and write typed calls against a stub server that responds with mock data.
- Stubs and real services share identical Schema shapes — switching implementations must not change OODA's code.

## Design decisions (locked)

- **One RpcGroup per service.** `AuthRpc`, `ProjectsRpc`, `SecretsRpc`, `AgentRpc` — each in its own file under `packages/contracts/src/groups/`. Composed into `GmackoRpcGroup` in the barrel.
- **Procedure naming: `service.action` dotted format** (matching existing pattern `threads.list`, `branches.create`). E.g. `auth.whoAmI`, `projects.create`, `secrets.decryptForUse`, `agent.sendTurn`.
- **`requires: [CurrentUser]`.** Procedures that need authenticated tenancy declare this. `AuthMiddleware.Service` wraps the plain-function middleware and populates `CurrentUser` before the handler runs. Non-authenticated procedures (none in 6F — we could add `auth.startDeviceFlow` unauthed, but it's fine to require auth for everything and add unauthed flows in 6J).
- **Streaming via `Rpc.make(tag, { stream: true, ... })`.** Only `agent.sendTurn` is streaming. Server-side SSE plumbing is deferred, but the contract declares streaming shape now so OODA's consumer code is type-correct from day one.
- **Tenant scope from CurrentUser.** Procedures do NOT take `tenantId` in their payload — the handler reads it from `CurrentUser`. This is cleaner than explicit tenant args in the wire format; `Tenancy.resolveForUser` already handles the Option-B picker logic at auth time.
- **Error types = Schema.TaggedErrorClass from the source packages.** `@gmacko/contracts` re-exports them so the client can catch typed errors. E.g. `SecretNotFoundError`, `ProjectSlugConflictError`, `TurnInProgressError`.
- **Stubs are deterministic, not random.** Fixed conversation IDs, fixed timestamps, fixed mock content strings. Lets OODA write golden-style tests.
- **Client SDK shape.** `createGmackoRpcClient({ baseURL, fetch? })` returns `{ auth, projects, secrets, agent }` where each is the typed RpcClient for its group. OODA can tree-shake unused groups by importing the group client factories directly from `@gmacko/client/auth`, etc.
- **No auto-bundled `layerGmackoServer`.** 6J composes server layers; 6F just exposes the contract groups + stub handler layers as named exports. App bootstrap (in the consuming Next.js/Bun/whatever server) does the final `RpcServer.layerHttp` call itself.

## Effect 4 API additions

Preemptive drift check found NO new drift rows. All 6F APIs are verified in the current master plan reference table:
- `Rpc.make(tag, { payload, success, error, stream? })` — `effect/unstable/rpc/Rpc.d.ts:287`. Streaming via `stream: true` flag; when true, `success` becomes `RpcSchema.Stream<Success, Error>` and `error` channel becomes `Schema.Never`.
- `RpcGroup.make(...rpcs)` — `effect/unstable/rpc/RpcGroup.d.ts:125`.
- `RpcClient.make(group)` + separate `RpcClient.layerProtocolHttp({ fetch? })` — `effect/unstable/rpc/RpcClient.d.ts:93, 156`.
- `RpcMiddleware.Service<Self, Config>()` — `effect/unstable/rpc/RpcMiddleware.d.ts:176`. 6C documented the opaque `SuccessValue` ergonomic trap; we wrap `resolveCurrentUser` without trying to test the middleware in isolation (unit test the plain function; integration-test the middleware via a real RpcGroup handler round-trip in Task 2).
- `RpcServer.layerHttp({ group, handlers })` — `effect/unstable/rpc/RpcServer.d.ts:71`.

## Task breakdown

Each task = RED → GREEN → COMMIT. One subagent per task.

### Task 1: Renumber master plan sub-phase roadmap

Tiny commit, zero behavior change. Edit `docs/plans/2026-04-19-phase6-core-finalization.md`:
- Insert `## 6F: RPC contract surface + client SDK (inserted 2026-04-21 for OODA integration)` ahead of the existing `## 6F: @gmacko/runner-protocol + @gmacko/runner-base` section.
- Rename headings: 6F runner → 6G; 6G realtime → 6H; 6H ui → 6I; 6I app-shell → 6J; 6J wire apps/web → 6K; 6K E2E + peripheral → 6L.
- Update any cross-references (grep for "6F:", "6G:", etc.).

Commit: `docs: renumber master plan sub-phases (new 6F = contracts, runner → 6G)`

### Task 2: Wrap `resolveCurrentUser` in `RpcMiddleware.Service`

`packages/auth/src/rpc-middleware.ts`:
```ts
import { RpcMiddleware } from "effect/unstable/rpc";
import { CurrentUser } from "@gmacko/rpc/context";
// Consume HttpServerRequest, extract headers+cookies, feed into resolveCurrentUser.
export class AuthMiddleware extends RpcMiddleware.Service<AuthMiddleware, {
  provides: typeof CurrentUser,
  failure: UnauthorizedError | TenantNotSelectedError,
  requires: HttpServerRequest.HttpServerRequest,
}>()("@gmacko/auth/AuthMiddleware", { /* config */ }) {}

export const layerAuthMiddleware: Layer.Layer<AuthMiddleware, never, Sessions | ApiKeys | Tenancy> = ...;
```

Plain-function `resolveCurrentUser` stays — the middleware calls it internally so we have ONE source of truth for extraction logic.

Tests — 3 cases (inside `packages/auth/src/__tests__/rpc-middleware.test.ts`):
1. Middleware populates `CurrentUser` given a valid session token header — integration test via a mini Rpc.make procedure + RpcServer.layerHttp.
2. Missing credentials surface `UnauthorizedError` via the RPC error channel.
3. Two-memberships-no-hint surfaces `TenantNotSelectedError` via the RPC error channel (not collapsed).

Commit: `feat(auth): wrap resolveCurrentUser in RpcMiddleware.Service (6C carryover)`

### Task 3: Auth contract group + stub handlers

`packages/contracts/src/groups/auth.ts`:
```ts
export const AuthWhoAmIRpc = Rpc.make("auth.whoAmI", {
  payload: Schema.Void,
  success: CurrentUserSchema,  // { userId, tenantId, email, role }
})  // requires CurrentUser

export const AuthListMembershipsRpc = Rpc.make("auth.listMemberships", {
  payload: Schema.Void,
  success: Schema.Array(MembershipSchema),
})

export const AuthResolveTenantRpc = Rpc.make("auth.resolveTenant", {
  payload: Schema.Struct({ tenantIdHint: Schema.optional(Schema.UUID) }),
  success: MembershipSchema,
  error: TenantNotSelectedError,
})

// api-keys
export const AuthIssueApiKeyRpc = Rpc.make("auth.issueApiKey", {
  payload: Schema.Struct({ name, permissions, ttlMs? }),
  success: Schema.Struct({ id, plaintext, keyPrefix }),
})

export const AuthListApiKeysRpc = Rpc.make("auth.listApiKeys", {
  payload: Schema.Void,
  success: Schema.Array(ApiKeyListItemSchema),
})

export const AuthRevokeApiKeyRpc = Rpc.make("auth.revokeApiKey", {
  payload: Schema.Struct({ apiKeyId }),
  success: Schema.Void,
  error: ApiKeyNotFoundError,
})

// device flow
export const AuthStartDeviceFlowRpc = Rpc.make("auth.startDeviceFlow", {
  payload: Schema.Void,
  success: Schema.Struct({ deviceCode, userCode, verificationUri, expiresAt }),
})

export const AuthPollDeviceCodeRpc = Rpc.make("auth.pollDeviceCode", {
  payload: Schema.Struct({ deviceCode }),
  success: DeviceCodePollResultSchema,
  error: InvalidDeviceCodeError,
})

export const AuthApproveDeviceCodeRpc = Rpc.make("auth.approveDeviceCode", {
  payload: Schema.Struct({ userCode }),
  success: Schema.Void,
  error: InvalidUserCodeError | AlreadyApprovedError,
})

export const AuthRpc = RpcGroup.make(
  AuthWhoAmIRpc,
  AuthListMembershipsRpc,
  AuthResolveTenantRpc,
  AuthIssueApiKeyRpc,
  AuthListApiKeysRpc,
  AuthRevokeApiKeyRpc,
  AuthStartDeviceFlowRpc,
  AuthPollDeviceCodeRpc,
  AuthApproveDeviceCodeRpc,
);
```

Stub handlers at `packages/contracts/src/stubs/auth.ts`:
```ts
export const layerStubAuthHandlers = AuthRpc.of({
  "auth.whoAmI": () => Effect.succeed({ userId: STUB_USER_ID, tenantId: STUB_TENANT_ID, email: "stub@example.com", role: "owner" }),
  ...
});
```

Tests — 3 cases proving:
1. RpcGroup composition: `AuthRpc` resolves 9 procedures by tag.
2. Each stub handler returns deterministic mock data that typechecks against the declared success schema.
3. CurrentUser-requiring procedures have correct type-level `requires` declaration (compile-time test or runtime assertion on group metadata).

Commit: `feat(contracts): add AuthRpc group + stub handlers`

### Task 4: Projects contract group + stub handlers

`packages/contracts/src/groups/projects.ts`:
```ts
export const ProjectsCreateRpc = Rpc.make("projects.create", {
  payload: Schema.Struct({ slug, name }),
  success: ProjectSchema,
  error: ProjectSlugConflictError,
});

export const ProjectsListRpc = Rpc.make("projects.list", {
  payload: Schema.Void,
  success: Schema.Array(ProjectSchema),
});

export const ProjectsGetBySlugRpc = Rpc.make("projects.getBySlug", {
  payload: Schema.Struct({ slug }),
  success: ProjectSchema,
  error: ProjectNotFoundError,
});

export const ProjectsDeleteRpc = Rpc.make("projects.delete", {
  payload: Schema.Struct({ projectId }),
  success: Schema.Void,
  error: ProjectNotFoundError,
});

export const ProjectsRpc = RpcGroup.make(ProjectsCreateRpc, ProjectsListRpc, ProjectsGetBySlugRpc, ProjectsDeleteRpc);
```

Stubs return 2 deterministic mock projects for `list`, the first one for `getBySlug`, etc.

Tests — 2 cases: group composition + stub round-trip (`list` returns the expected mock array).

Commit: `feat(contracts): add ProjectsRpc group + stub handlers`

### Task 5: Secrets contract group + stub handlers

`packages/contracts/src/groups/secrets.ts` — procedures:
- `secrets.create` — Input: `{ name, plaintext, policy?, usesRemaining? }` → SecretEnvelope
- `secrets.list` — → `Array<SecretEnvelope>`
- `secrets.getEnvelope` — `{ secretId }` → SecretEnvelope (no plaintext; named "getEnvelope" to make the no-plaintext contract explicit)
- `secrets.decryptForUse` — `{ secretId, templateId?, args? }` → `{ plaintext, envelope }`. Errors: `SecretNotFoundError | PolicyDeniedError | MaxUsesExceededError`.
- `secrets.markUsed` — `{ secretId, templateId?, commandPrefix?, success? }` → `void`
- `secrets.delete` — `{ secretId }` → `void`. Error: `SecretNotFoundError`.

Stubs mock the 6 behaviors deterministically.

Tests — 3 cases.

Commit: `feat(contracts): add SecretsRpc group + stub handlers`

### Task 6: Agent contract group + stub handlers (INCLUDING STREAMING)

`packages/contracts/src/groups/agent.ts`:
```ts
export const AgentCreateSessionRpc = Rpc.make("agent.createSession", {
  payload: Schema.Struct({ adapterId, title?, systemPrompt?, allowedTools?, cwd? }),
  success: Schema.Struct({ conversationId, status: "pending" }),
});

export const AgentSendTurnRpc = Rpc.make("agent.sendTurn", {
  stream: true,  // ← streaming procedure
  payload: Schema.Struct({ conversationId, prompt }),
  success: AgentEventSchema,
  error: AgentSessionNotFoundError | TurnInProgressError | AdapterSpawnError | AdapterExitError,
});

export const AgentCancelSessionRpc = Rpc.make("agent.cancelSession", {
  payload: Schema.Struct({ conversationId }),
  success: Schema.Void,
  error: AgentSessionNotFoundError,
});

export const AgentCloseSessionRpc = Rpc.make("agent.closeSession", {
  payload: Schema.Struct({ conversationId }),
  success: Schema.Void,
  error: AgentSessionNotFoundError,
});

export const AgentGetTranscriptRpc = Rpc.make("agent.getTranscript", {
  payload: Schema.Struct({ conversationId }),
  success: Schema.Struct({
    conversation: ChatConversationSchema,
    messages: Schema.Array(ChatMessageSchema),
  }),
  error: AgentSessionNotFoundError,
});

export const AgentRpc = RpcGroup.make(
  AgentCreateSessionRpc,
  AgentSendTurnRpc,
  AgentCancelSessionRpc,
  AgentCloseSessionRpc,
  AgentGetTranscriptRpc,
);
```

**Schema.Struct for AgentEvent tagged union:** the wire format of `AgentEvent` needs a Schema representation. Define `AgentEventSchema` as `Schema.Union(...)` matching the runtime tagged union. Lives in `packages/contracts/src/schemas/agent.ts`.

Stubs — `agent.createSession` returns fixed conversation id; `agent.sendTurn` stream emits 3 mock events (session_init, text_delta, turn_end); `agent.getTranscript` returns fixed user + assistant messages.

Tests — 4 cases including `agent.sendTurn` stream round-trip via `Stream.runCollect`.

Commit: `feat(contracts): add AgentRpc group + stub handlers (incl. streaming sendTurn)`

### Task 7: Scaffold `@gmacko/client` package

33rd package. Deps: `@gmacko/contracts` (workspace), `effect`. DevDeps mirror `@gmacko/auth`.

Smoke test asserts `__gmackoClientPhase === "6f"` sentinel.

Commit: `chore: scaffold @gmacko/client package`

### Task 8: `@gmacko/client` SDK composition

`packages/client/src/index.ts`:
```ts
export interface GmackoClientOptions {
  readonly baseURL: string;
  readonly fetch?: typeof fetch;
  readonly headers?: Record<string, string>;
}

export function createGmackoRpcClient(opts: GmackoClientOptions) {
  const protocol = RpcClient.layerProtocolHttp({ url: opts.baseURL, fetch: opts.fetch, headers: opts.headers });
  return {
    auth: makeAuthClient(protocol),
    projects: makeProjectsClient(protocol),
    secrets: makeSecretsClient(protocol),
    agent: makeAgentClient(protocol),
  };
}
```

Each `make*Client` is an `RpcClient.make(<Group>)` wrapped in an Effect-to-Promise facade so OODA (browser, non-Effect runtime) can call `.auth.whoAmI()` and get a Promise. Streaming procedures return an `AsyncIterable<AgentEvent>` (not Effect Stream) so browser consumers use `for await`.

Tests — 4 cases (1 per group) proving the facade shape.

Commit: `feat(client): add createGmackoRpcClient with per-group facades`

### Task 9: End-to-end smoke test — stub server + client round-trip

`packages/client/src/__tests__/e2e.test.ts`:
- Spin up a Node HTTP server in-test running `RpcServer.layerHttp` with all four stub handler layers.
- Create a client pointing at the server's URL.
- Call one procedure per group; assert the returned data matches the stub.
- For `agent.sendTurn`, consume the async iterable and assert 3 events.

Tests — 3 cases (or 4 including the streaming path).

Commit: `test(client): add e2e stub-server + client round-trip smoke test`

### Task 10: OODA integration README

`docs/ooda-integration.md`:
- What `@gmacko/client` is; how to install.
- Stub vs real: which procedures have stubs now, which will swap for real service calls in 6J/future phases.
- Example code: login flow, project creation, secret issuing, agent session with streaming.
- Migration notes: how to migrate from the legacy OODA `threads.*` / `branches.*` / `messages.*` / `exploration.*` procedures to the new `agent.*` surface (incremental — both coexist in `@gmacko/contracts`).
- Authentication: how to pass session token or API key headers.

No tests — doc only.

Commit: `docs: OODA integration guide for @gmacko/client`

### Task 11: Exit verification + tag

1. `pnpm -r --filter '!./apps/*' typecheck` green.
2. Full test suite ≥ 245 passing. Serial runners for PGlite-heavy packages (known parallel flakiness from 6B/6C/6D/6E).
3. Git tree clean.
4. Tag `phase-6f-complete`.
5. Append "Phase 6F — Completed" to this plan.
6. Merge to master + push tag.

---

## Open items carried into 6G onboarding

- **Real handler implementations** for every stub procedure — 6J app wiring is the natural home.
- **SSE server transport** — `agent.sendTurn`'s streaming contract exists but server-side SSE plumbing lands in 6J alongside the actual Next.js route handler.
- **Session cookie forwarding** in the client SDK — scaffolded but real auth bootstrapping / cookie jar handling lands in 6J.
- **Legacy OODA procedure migration** — `threads.*` / `branches.*` / `messages.*` / `exploration.*` stay in `@gmacko/contracts` for OODA compat; map them to the new gmacko services gradually as OODA's product shape converges.
- **Client tree-shaking** — ensure importing just `@gmacko/client/auth` doesn't drag in the agent streaming machinery, etc. Real verification happens when OODA's bundler reports sizes.

## Convention reinforced

- Each task = RED → GREEN → COMMIT with dedicated subagent.
- Contracts land ahead of implementations when integration consumers need stable types.
- Stubs return deterministic data so consumers can write golden tests.
- Schema shapes are identical between stubs and real; swapping doesn't break consumer code.

---

## Phase 6F — Completed ✅

Tagged `phase-6f-complete`. **33 packages** (added `@gmacko/client` as the 33rd; `packages/` dir count is 32 since `tooling/typescript` is counted by the plan methodology but lives outside `packages/`). Workspace typecheck green. **246 tests passing** (up from 222 at end of 6E; forecast was ≥245).

### What landed

- **Master plan renumbering** (Task 1, `d716d7e`) — old 6F runner-protocol shifts to 6G, cascade through 6L. New 6F is contracts.
- **`AuthMiddleware.Service` wrap** (Task 2, `a9f7a0f`) — `resolveCurrentUser` from 6C is now wrapped in `RpcMiddleware.Service` so contract procedures can declare `requires: [CurrentUser]`. Plain-function middleware stays as the non-RPC path. 3 integration tests via `RpcTest.makeClient`.
- **4 new RpcGroups** (Tasks 3-6, `fe04361` / `56c2860` / `9b13640` / `2d88693`):
  - `AuthRpc` — 9 procedures (whoAmI, listMemberships, resolveTenant, issueApiKey, listApiKeys, revokeApiKey, startDeviceFlow, pollDeviceCode, approveDeviceCode).
  - `ProjectsRpc` — 4 procedures (create, list, getBySlug, delete).
  - `SecretsRpc` — 6 procedures (create, list, getEnvelope, decryptForUse, markUsed, delete). `decryptForUse` is the only plaintext path.
  - `AgentRpc` — 5 procedures including the streaming `agent.sendTurn` (first use of `Rpc.make({stream: true, ...})` in gmacko).
  - Each group ships with deterministic stub handler Layers (`stubAuthHandlers`, `stubProjectsHandlersLayer`, `layerStubSecretsHandlers`, `stubAgentHandlers.layer`) that return mock data so OODA can hit real RPC endpoints during dev.
- **`@gmacko/client` package** (Tasks 7-8, `5016432` / `488a247`) — 33rd package. `createGmackoRpcClient({baseURL, fetch?, headers?})` returns `{auth, projects, secrets, agent}` with Promise-based methods and an `AsyncIterable` for `agent.sendTurn` streaming. Custom fetch via `Layer.succeed(FetchHttpClient.Fetch, fetch)`; custom headers via `transformClient`.
- **End-to-end smoke test** (Task 9, `dc40f42`) — real Node HTTP server + merged stub Layer + full-stack round-trip (4 happy-path tests including streaming).
- **OODA integration README** (Task 10, `e7fe768`) — 596-line consumer guide at `docs/ooda-integration.md` with install/setup, per-group method reference, stub-server spin-up pattern, tagged error catching (`_tag`-based, not `instanceof`), and the incremental migration story from legacy OODA procedures (`threads.*`, `exploration.*`, etc.) to the new `agent.*` surface.

### Effect 4 drift findings added to master plan

**12 new drift rows** from 6F — more than any prior phase because this is the first real use of `Rpc` / `RpcGroup` / `RpcClient` / `RpcServer` / `RpcMiddleware.Service` / HTTP transport at depth:

1. `RpcMiddleware.Service<Self, Config>()` — Config keys are `provides` / `requires` / `clientError` (NOT `failure`). Error schema on second options arg.
2. `Schema.Union` takes an **array**, not varargs.
3. `RpcGroup.Rpcs<Group>` (type alias) — not `Rpc.Rpcs<Group>`.
4. `HttpServerRequest` captured at server build time via `Effect.services()`; for per-request behavior mount via `RpcServer.layerHttp` + `HttpRouter.toWebHandler`.
5. `DateTime.unsafeMake` → `DateTime.makeUnsafe` (consistent renaming).
6. `Schema.Record(key, value)` positional args — not object form.
7. `Cause.failureOption` → `Cause.findErrorOption`.
8. `RpcClient.layerProtocolHttp({...})` narrow option set: only `{url, transformClient?}`. No `fetch` / `headers` / `baseUrl` keys.
9. `RpcClient` streaming scope lifecycle — queue dies when outer scope closes; consume inside scope or build a SDK-owned scope that outlives the iterable.
10. `RpcServer.layerHttp` + `layerJson` buffers streams as single JSON array — use `layerNdjson` for true chunked streaming.
11. `HttpRouter.toWebHandler` takes the app Layer (not router), returns `{handler, dispose}`.
12. Tagged-error round-trip: client-side decoded errors are fresh instances; `err._tag` is the stable contract, NOT `instanceof`.

### Scope deviation from plan

- **Test forecasts:** Task 10's forecast was "+1" but docs tasks produce 0 tests. Rolled into the README work without a test contribution, which is correct. Actual final count (246) is consistent with the group-level forecasts (+0 for renumber, +3 middleware, +3 auth, +2 projects, +3 secrets, +4 agent, +1 client scaffold, +4 client shape, +4 e2e smoke, +0 docs) = +24 over the 222 6E baseline. Plan's total-forecast of 245 was slightly conservative.
- **`RpcGroup.merge` + `Layer.mergeAll` for stub server** (Task 9) — worked cleanly. Didn't need to mount each group at a separate URL prefix.
- **Header-injection end-to-end not tested.** Task 9's stub handlers don't echo headers, so we tested the plumbing at type level only. Real header flow lands when 6K mounts real handlers.
- **Streaming caveat surfaced late.** Task 9 discovered that `RpcServer.layerHttp` + `layerJson` buffers streams rather than chunked-streaming them. For OODA's stub-server UX this is fine (full event sequence arrives when the turn ends), but 6K will need to swap to `RpcSerialization.layerNdjson` for real SSE transport. Documented in the master plan drift table and the 6F README's caveats section.

### Known rough edges (non-blocking)

- **`RpcClient` streaming scope leak workaround.** `packages/client/src/internal/runtime.ts:146-162` currently collects the entire stream inside the scope before exposing as `AsyncIterable`. This buffers the whole response — fine for stub sizes but wrong for long-lived / real streaming. Cleaner fix in 6K: a scope that outlives the iterable consumer (spawn a scope in `runStream`, hold a strong reference, close explicitly when the consumer is done iterating).
- **Tagged-error `instanceof` gap.** Consumer code cannot use `err instanceof ProjectSlugConflictError` to catch RPC-transported errors — must check `err._tag === "ProjectSlugConflictError"`. Documented in OODA README.
- **PGlite parallel-run flakiness** carried over from 6B-6E; exit verification ran PGlite-heavy packages serially (`--no-file-parallelism`). Still non-blocking.

### Open items carried into 6G onboarding

Still deferred, unchanged from 6E retro except "6J → 6K" renumbering:
- **Other CLI adapters** (`CodexCliAdapter`, `CursorAcpAdapter`) — follow-up phases implementing `AgentAdapter`.
- **Real service-backed RPC handlers** — swap stubs for real `@gmacko/auth` / `@gmacko/projects` / `@gmacko/secrets` / `@gmacko/agent` service layer mounts. **Now 6K** (not 6J).
- **Per-tenant Anthropic API keys** via `@gmacko/secrets` — 6K or later.
- **`session_secret_usages.sessionId → chat_conversations.id` FK promotion** — can land any time now that chat_conversations exists. Probably 6K as part of schema consolidation.
- **`chat_conversations.projectId`** — optional FK to `projects.id` for project-scoped conversations. Schema change + service plumbing. No timeline.
- **Token usage + cost tracking** — `stream-json` exposes it; `chat_messages.metadata.usage` is the natural home. Opportunistic capture when 6K wires real handlers.

New from 6F:
- **True SSE/chunked streaming transport** — swap `RpcSerialization.layerJson` for `layerNdjson` on both client and server when 6K lands real handlers.
- **Long-lived async-iterable consumer scope** — rework `@gmacko/client/internal/runtime.ts`'s `runStream` so streams are consumed outside the original scope, not buffered. 6K or later.
- **Unify stub-vs-real handler mount** — right now 6F ships stub Layers in `@gmacko/contracts/stubs/*`. 6K will ship real Layers in each service package (probably `@gmacko/<svc>/rpc-handlers` or similar). A tiny composition helper that picks stub/real by env var + mounts would reduce 6K's bootstrap code.
- **Header-injection end-to-end coverage.** Add a stub handler in 6K (or 6F.1 follow-up) that echoes a request header, plus a test proving `createGmackoRpcClient({headers})` round-trips it.
