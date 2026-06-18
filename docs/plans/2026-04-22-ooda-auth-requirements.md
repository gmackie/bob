# OODA Auth Requirements for @gmacko/auth

> From: OODA team — what we need from the base layer to replace the interim loopback-only gate.

## Current state (OODA v1.5)

OODA has no user identity. Two mechanisms keep the door closed:

1. **Next.js middleware** (`apps/web/src/middleware.ts`) — rejects non-loopback requests to `/api/buddy/*` with 403.
2. **tRPC `loopbackOnlyProcedure`** (`packages/api/src/trpc.ts:62`) — rejects non-loopback on write-side mutations (`runEmbedding`, `runClustering`, `kbPromoteRequest`).

Read-side queries use `vaultScopedProcedure` (no auth, vault resolved from middleware). Write-side buddy mutations use `vaultScopedLoopbackProcedure` (loopback + vault scope).

Once `@gmacko/auth` lands with `CurrentUser`, we can replace both gates with real session checks.

---

## What OODA needs

### 1. `CurrentUser` resolution in tRPC context

OODA uses tRPC (not Effect Rpc). We need a way to resolve `CurrentUser` from a tRPC request's headers/cookies without pulling in the full Effect runtime.

**Ideal:** a plain function like `resolveCurrentUser(req: Request)` that returns `{ userId, tenantId, email, role }` or throws — we already see this exists in `@gmacko/auth/middleware.ts`. If there's a non-Effect overload (or a simple `validateToken(cookie) → SessionValidationResult` call), that's all we need.

**Fallback:** we can wrap the Effect call ourselves — just need `Sessions.validateToken` or `Sessions.validateBearer` accessible without a full Effect Layer bootstrap.

### 2. Session cookie name + format

We need to know which cookie carries the session token so our tRPC middleware can extract it. Better-auth defaults to `better-auth.session_token` — confirm this is the name, or tell us the configured one.

### 3. Thread ownership model

OODA threads don't have an `ownerId` column yet. Once auth lands we'll add one. We need:

- The branded `UserId` type from `@gmacko/validators` (already exported).
- Confirmation that `tenantId` scoping applies to OODA threads (does a thread belong to a user within a tenant, or just a user?).

### 4. SSE subscriber authorization

`/api/buddy/events` is a Server-Sent Events endpoint (not tRPC). It needs to:

- Validate the session from the request (cookie or `Authorization` header).
- Filter `buddy_inbox_new` payloads by the subscriber's vault access — currently (`filter.ts:31`) vault-global events pass regardless of subscriber scope, which is a cross-vault leak once a second vault is live.
- Cap per-session SSE connections — each subscriber opens a `postgres.js` LISTEN connection; the pool will exhaust under concurrent subscribers.

For this we need the same token validation function from item 1, callable from a plain Next.js API route handler.

### 5. API key support (nice-to-have)

If `@gmacko/auth` ships tenant-scoped API keys with the `gmk_` prefix, OODA's runner could authenticate via API key instead of the current shared-secret `.runner-token` file. Not blocking — the runner token works fine for single-user — but it would clean up the runner auth path for multi-user.

---

## What we'll do on our side (once the above lands)

1. Add `ownerId: UserId` to `research_thread` schema.
2. Replace `loopbackOnlyProcedure` with an `authedProcedure` that calls `validateToken` / `validateBearer`.
3. Add thread-ownership checks on sensitive mutations (`inboxTriage`, `interestRegister`, `interestUpdate`, `interestDisable`, `kbPromoteRequest`).
4. Add vault-scoped filtering on SSE payloads using `CurrentUser.tenantId` or a vault-access check.
5. Delete `apps/web/src/middleware.ts` loopback gate.
6. Pool SSE LISTEN connections (one shared PG connection for LISTEN, fan out in-process).

---

## Protected procedures (full inventory)

For reference, these are all the procedures that currently rely on loopback gating:

| Procedure | Current gate | Post-auth gate |
|---|---|---|
| `runEmbedding` | `loopbackOnlyProcedure` | authed + admin role |
| `runClustering` | `loopbackOnlyProcedure` | authed + admin role |
| `kbPromoteRequest` | `loopbackOnlyProcedure` | authed + thread owner |
| `inboxTriage` | via `vaultScopedLoopbackProcedure` | authed + thread owner |
| `interestRegister` | via `vaultScopedLoopbackProcedure` | authed + thread owner |
| `interestUpdate` | via `vaultScopedLoopbackProcedure` | authed + thread owner |
| `interestDisable` | via `vaultScopedLoopbackProcedure` | authed + thread owner |
| `/api/buddy/events` SSE | Next.js middleware loopback | session cookie/bearer |
