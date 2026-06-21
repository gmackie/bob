# Bob Effect-RPC → OpenAPI / REST / Typed Client

> **For Claude:** REQUIRED SUB-SKILL: use `superpowers:executing-plans` to implement this task-by-task. Each task has a verification step; do not advance until it is green.

**Status:** DRAFT — awaiting review. Supersedes the **Bob portion** of
`docs/plans/2026-04-30-phase9-openapi.md` (Tasks 9 & 11). The OODA portion of
Phase 9 (Tasks 1–8, `trpc-to-openapi`) is unaffected and stays as-is.

## Why Phase 9's Bob plan is stale

Phase 9 (2026-04-30) assumed Bob's API was tRPC and proposed walking the tRPC
router tree with a hand-rolled introspector (`router-openapi.ts`) plus
`z.toJSONSchema`. Since then Bob migrated to **Effect-RPC**:

- Contracts are now `RpcGroup.make(Rpc.make("tag", { payload, success, error }))`
  with Effect `Schema` (not Zod), in `@gmacko/bob/contracts` (3 groups) and
  `@gmacko/core/contracts/groups/*` (6 groups).
- The server mounts them at `/api/rpc` via `RpcServer.layerHttp` (ndjson),
  309 procedures across 9 groups — see `apps/bob/src/server/rpc.ts`.
- `@gmacko/bob-client` already exists as an **Effect-RPC** client
  (`createBobRpcClient`), but every method is typed `(input?: unknown) =>
  Promise<unknown>` — the contract types are erased in `internal/invoke.ts`.
- The legacy `createBobClient` (openapi-fetch) in `packages/bob-client/src/index.ts`
  has a TODO to wire a generated `schema.d.ts`, but no spec file or REST surface
  exists yet, and it has zero real consumers.

The tRPC-tree-walking generator cannot read the new contracts. We replace it
with an **Effect-RPC-group-walking** generator. The whole Schema→JSON-Schema→
OpenAPI pipeline is supported by `effect`'s own library (`Schema.toJsonSchemaDocument`
+ `effect/JsonSchema`); no third-party tool is needed on the server side.

## Goal

The Effect-RPC contract groups are the single source of truth. From them:

1. Generate an **OpenAPI 3.1 document** describing every procedure as a REST op.
2. Serve a **REST bridge** (`/api/v1/...`) that dispatches to the existing RPC
   handlers, so non-Effect consumers (external API, mobile over plain HTTP,
   third parties) can call Bob without the ndjson RPC transport.
3. Generate `schema.d.ts` via `openapi-typescript` and make `createBobClient`
   fully typed against it.

The existing Effect-RPC `createBobRpcClient` (used by web/mobile/CLI) is
unchanged — this adds the typed REST surface alongside it.

## Architecture

```
RpcGroup.make(...)  ──walk group.requests──►  per-Rpc { key, payloadSchema, successSchema }
        │                                              │
        │                          Schema.toJsonSchemaDocument(schema)
        │                                              ▼
        │                          JsonSchema.toMultiDocumentOpenApi3_1(...)
        │                                              ▼
        └────────────────────────────────►  OpenAPI 3.1 Document (paths + components)
                                                       │
                         ┌─────────────────────────────┼─────────────────────────────┐
                         ▼                             ▼                              ▼
              GET /api/openapi.json         REST bridge /api/v1/*          openapi-typescript
              (serve the spec)              (dispatch → RPC handler)       → schema.d.ts → createBobClient<paths>
```

**Effect primitives this depends on (verified in effect@4.0.0-beta.43):**
- `RpcGroup.requests: ReadonlyMap<string, Rpc>` — enumerate procedures.
- `Rpc.key` / `Rpc.payloadSchema` / `Rpc.successSchema` / `Rpc.errorSchema`.
- `Schema.toJsonSchemaDocument(schema, options?)` → JSON Schema document.
- `effect/JsonSchema`: `toMultiDocumentOpenApi3_1`, `fromSchemaOpenApi3_1`,
  `resolveTopLevel$ref`.

## Open design decisions (resolve during review)

- **D1 — REST verb/path scheme.** RPC tags are dotted (`workItem.link.list`).
  Proposal: POST `/api/v1/{tag-as-kebab-path}` with the payload as JSON body for
  everything (uniform, matches existing `work-items-rest.ts` which already uses
  `POST /api/v1/work-items/...`). Alternative: GET+query for read-only ops
  (nicer REST, but requires classifying each of 309 procedures). **Recommend:
  uniform POST first, add GET for reads later.**
- **D2 — REST bridge breadth.** Bridge all 309 procedures, or only the groups an
  external consumer needs (external/webhook/public API + work-items)? **Recommend:
  generate the spec for all; mount the REST bridge for the externally-facing
  groups first, expand later.** Spec ≠ live endpoint.
- **D3 — Auth on REST.** Reuse `AuthMiddleware` (session cookie) + API-key bearer,
  matching `work-items-rest.ts` `auth: "session" | "apiKey"`. Each Rpc needs an
  auth tag; default to session unless annotated. **Recommend: annotate via Rpc
  annotations, default session.**
- **D4 — Spec generation timing.** Build-time script writing
  `dist/openapi/bob.json` (Phase 9 Task 10 pattern, feeds openapi-typescript) AND
  a runtime `GET /api/openapi.json`. **Recommend: both — same generator function.**

## Tasks

### Task 0 — Spike: confirm the Schema→OpenAPI call shape (no commit)

**Files:** scratch only (`/tmp/spike.ts` run via `tsx`).

Walk `WorkItemsRpc.requests`, pick `workItem.list`, and run:
`Schema.toJsonSchemaDocument(rpc.payloadSchema)` then
`JsonSchema.toMultiDocumentOpenApi3_1(...)`. Confirm the exact option object
needed (target dialect `openapi-3.1`, `$ref` handling) and that
`Schema.optional` / `Schema.NullOr` / enums render correctly.

**Verify:** prints a valid OpenAPI-3.1 schema fragment for the `workItem.list`
payload + success. Capture the precise call in a comment for Task 1.

**OUTCOME (2026-06-21 — DONE):** confirmed against effect@4.0.0-beta.43.
- `WorkItemsRpc.requests` is a `ReadonlyMap<tag, Rpc>`; each `rpc` exposes
  `key`, `payloadSchema`, `successSchema`, `errorSchema`.
- `Schema.toJsonSchemaDocument(schema)` → `{ dialect: "draft-2020-12", schema }`
  where `.schema` is the root JSON Schema node. **No `Schema.toJsonSchemaMultiDocument`
  exists** — only the single-Document path.
- OpenAPI 3.1 == JSON Schema 2020-12, so embed `.schema` directly into
  `content["application/json"].schema`. For v1, inline `$defs` per-operation via
  `JsonSchema.resolveTopLevel$ref`; defer shared `components.schemas` extraction
  (and `JsonSchema.toMultiDocumentOpenApi3_1`) to a later pass.
- Known cosmetic: `Schema.optional(Schema.NullOr(x))` emits nested double-`null`
  `anyOf`. Harmless for openapi-typescript; optionally flatten later.

### Task 1 — Effect-RPC → OpenAPI generator

**Files:**
- Create: `packages/bob/src/api/src/contracts/rpc-openapi.ts`
- Test: `packages/bob/src/api/src/contracts/__tests__/rpc-openapi.test.ts`

Export `generateOpenApiFromRpcGroups(groups, config)`:
- For each group, iterate `group.requests`. For each `rpc`:
  - `tag = rpc.key`; OpenAPI `tags: [tag.split(".")[0]]`; `operationId = tag`.
  - REST path from D1 scheme; method per D1.
  - requestBody/params ← `Schema.toJsonSchemaDocument(rpc.payloadSchema)`.
  - 200 response ← `Schema.toJsonSchemaDocument(rpc.successSchema)`.
  - error responses ← `rpc.errorSchema` mapped to 4xx (BobNotFoundError→404,
    BobForbiddenError→403, default 400/401).
- Hoist shared `$defs` into `components.schemas`; security schemes per D3.

**Test (TDD):** assert the doc is `openapi: "3.1.0"`, contains
`workItem.list`'s path, its payload fields appear in the request schema, and
`components.securitySchemes` has `bearerAuth` + `cookieAuth`.

**Verify:** `pnpm --filter @bob/api test -- rpc-openapi` green.

### Task 2 — Assemble the full Bob document

**Files:**
- Modify: `packages/bob/src/api/src/openapi.ts`
- Test: extend `__tests__/rpc-openapi.test.ts`

Add `generateBobApiDocument(config)` that feeds all 9 groups (import the same
list `apps/bob/src/server/rpc.ts` composes into `BobRpcGroup`; extract that
array into a shared `contracts` export so server and generator share one source)
into `generateOpenApiFromRpcGroups`. Keep the legacy Zod `generateApiDocument`
until the REST bridge replaces `work-items-rest.ts`, then delete it.

**Verify:** test asserts ≥ 300 operations and stable tag set (9 groups).

### Task 3 — Serve the spec at `GET /api/openapi.json`

**Files:**
- Create the route in Bob's app (mirror `apps/ooda/src/app/api/openapi/route.ts`;
  adapt to Bob's Vite/CF Workers entry — confirm the router location).
- Modify: `packages/bob/src/config/src/integrations.ts` (`openapi: true`).

**Verify:** `curl localhost:<port>/api/openapi.json | jq '.info'` returns the
Bob info block; path count matches Task 2.

### Task 4 — REST bridge `/api/v1/*` → RPC handlers

**Files:**
- Create: `packages/bob/src/api/src/rest/bridge.ts`
- Wire into Bob's HTTP router alongside `/api/rpc` and `/api/trpc`.

For each procedure in the externally-facing groups (D2): register an HTTP route
(D1 verb/path) that decodes the body with `rpc.payloadSchema`, invokes the SAME
handler layer the RPC server uses (`allHandlers` from `apps/bob/src/server/rpc.ts`
— factor the handler layer into a shared export), encodes the result with
`rpc.successSchema`, and maps errors per Task 1. Reuse `AuthMiddleware` (D3).

**Test:** integration test hitting one read (`workItem.list`) and one write
through the bridge with a stubbed handler layer; assert status + shape.

**Verify:** `pnpm --filter @bob/api test -- rest-bridge` green; migration
guardrail test still green (bridge is server-side, not in bob-client).

### Task 5 — Build-time spec emit

**Files:**
- Create: `scripts/generate-bob-openapi.ts` (or extend Phase 9's
  `scripts/generate-openapi.ts` if it exists)
- Modify: root `package.json` (`"generate:openapi:bob"`), `.gitignore`
  (`dist/openapi/`)

Write `dist/openapi/bob.json` from `generateBobApiDocument`.

**Verify:** `pnpm generate:openapi:bob` writes the file; `jq '.paths | length'`
matches Task 2.

### Task 6 — Type `createBobClient` from the generated schema

**Files:**
- Modify: `packages/bob-client/package.json` (add `openapi-typescript` dev dep;
  `"generate": "pnpm generate:openapi:bob && openapi-typescript dist/openapi/bob.json -o src/schema.d.ts"`)
- Create: `packages/bob-client/src/schema.d.ts` (generated, gitignored or
  committed — decide in review)
- Modify: `packages/bob-client/src/index.ts` — replace the deprecated untyped
  `createBobClient` with `createClient<paths>({ baseUrl })`; remove the stale
  TODO. Keep `createBobRpcClient` (Effect-RPC) unchanged.

**Verify:** `pnpm --filter @gmacko/bob-client run generate` produces
`schema.d.ts`; `pnpm --filter @gmacko/bob-client typecheck` clean; a new
`shape.test.ts` assertion confirms `createBobClient().GET("/api/v1/...")` is
type-checked (no `any`).

### Task 7 — Docs + guardrail update

- Update `packages/bob-client/src/__tests__/migration-guardrails.test.ts` to also
  scan the now-tracked client files (currently `git ls-files` misses them — they
  were untracked when the guardrail was written; they are committed as of
  `feat/bob-effect-rpc-client`).
- Note in `CLAUDE.md` Bob section that REST/OpenAPI derives from the Effect-RPC
  contracts.

**Verify:** full `pnpm exec turbo run test --concurrency=1 -- --no-file-parallelism`
for `@bob/api` + `@gmacko/bob-client` green.

## Out of scope

- Typing the Effect-RPC `createBobRpcClient` methods (the `RpcMethod = unknown`
  erasure). That is a separate effort — idiomatic fix is exposing
  `RpcClient.make(group)`'s inferred client instead of the hand-rolled
  string-tag `makeInvoke`. Track separately.
- OODA OpenAPI (already done in Phase 9 Tasks 1–8).
- The Python research sidecar spec (Phase 9 Task 12).

## Summary

| Task | Scope | Risk |
|------|-------|------|
| 0 | Spike Schema→OpenAPI call | none (no commit) |
| 1 | RpcGroup→OpenAPI generator | med (schema edge cases) |
| 2 | Full 9-group document | low |
| 3 | Serve `/api/openapi.json` | low |
| 4 | REST bridge → handlers | high (auth, handler reuse) |
| 5 | Build-time emit | low |
| 6 | Type `createBobClient` | low |
| 7 | Guardrails + docs | low |
