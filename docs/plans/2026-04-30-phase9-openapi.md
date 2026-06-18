# Phase 9: OpenAPI Specs & Client Generation

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add OpenAPI 3.1 spec generation to both OODA (68 procedures) and Bob (200+ procedures) tRPC routers, and produce typed client packages for cross-app integration.

**Architecture:** Use `trpc-to-openapi@3.2.0` (compatible with tRPC 11.7.2) to annotate procedures with OpenAPI meta and generate specs. Bob already has a custom OpenAPI generator for work-items — extend that pattern for the full API. Each app serves its spec at `/api/openapi.json`. Generated client packages (`@gmacko/ooda-client`, `@gmacko/bob-client`) use `openapi-fetch` for typed HTTP calls.

**Tech Stack:** `trpc-to-openapi@3.2.0`, `zod-openapi@^5.0.1`, `openapi-types`, `openapi-fetch`, `openapi-typescript` (CLI for client codegen)

---

## Task 1: Add Dependencies

**Files:**
- Modify: `packages/ooda/package.json`
- Modify: `pnpm-workspace.yaml` (add to catalog)

**Step 1: Add trpc-to-openapi and zod-openapi to the pnpm catalog**

In `pnpm-workspace.yaml`, add to the `catalog:` section:

```yaml
  trpc-to-openapi: ^3.2.0
  zod-openapi: ^5.0.1
```

**Step 2: Add dependencies to OODA**

```bash
cd ~/.config/superpowers/worktrees/gmacko/phase-9-openapi
pnpm add -F @gmacko/ooda trpc-to-openapi zod-openapi
```

**Step 3: Verify install succeeds**

```bash
pnpm install
pnpm exec turbo run typecheck --filter=@gmacko/ooda
```

Expected: clean install, typecheck passes.

**Step 4: Commit**

```bash
git add pnpm-workspace.yaml packages/ooda/package.json pnpm-lock.yaml
git commit -m "chore: add trpc-to-openapi and zod-openapi deps"
```

---

## Task 2: Wire OpenApiMeta into OODA tRPC Init

**Files:**
- Modify: `packages/ooda/src/api/trpc.ts`
- Test: `packages/ooda/src/api/__tests__/openapi-meta.test.ts`

**Step 1: Write the failing test**

Create `packages/ooda/src/api/__tests__/openapi-meta.test.ts`:

```typescript
import { describe, expect, it, vi } from "vitest";

vi.mock("@gmacko/ooda/db/client", () => ({ db: {} }));
vi.mock("@gmacko/ooda/db/auth", () => ({
  validateSessionToken: vi.fn(),
  extractSessionToken: vi.fn(),
  SessionNotFoundError: class extends Error {},
}));

describe("tRPC OpenAPI meta", () => {
  it("t instance accepts OpenApiMeta on procedures", async () => {
    const { t } = await import("../trpc");
    // If meta<OpenApiMeta> is wired, this compiles and runs without error
    const proc = t.procedure
      .meta({ openapi: { method: "GET", path: "/test" } })
      .query(() => "ok");
    expect(proc).toBeDefined();
  });

  it("procedures without meta still work", async () => {
    const { publicProcedure } = await import("../trpc");
    const proc = publicProcedure.query(() => "ok");
    expect(proc).toBeDefined();
  });
});
```

**Step 2: Run test to verify it fails**

```bash
cd ~/.config/superpowers/worktrees/gmacko/phase-9-openapi
pnpm exec vitest run packages/ooda/src/api/__tests__/openapi-meta.test.ts
```

Expected: FAIL — `meta` call rejects OpenApiMeta shape because `t` has no meta type.

**Step 3: Wire OpenApiMeta into initTRPC**

Modify `packages/ooda/src/api/trpc.ts`:

```typescript
// Add import at top
import type { OpenApiMeta } from "trpc-to-openapi";

// Change initTRPC chain to include .meta<OpenApiMeta>()
export const t = initTRPC
  .meta<OpenApiMeta>()
  .context<typeof createTRPCContext>()
  .create({
    transformer: superjson,
    errorFormatter: ({ shape, error }) => ({
      ...shape,
      data: {
        ...shape.data,
        zodError:
          error.cause instanceof ZodError
            ? z.flattenError(error.cause as ZodError<Record<string, unknown>>)
            : null,
      },
    }),
  });
```

**Step 4: Run test to verify it passes**

```bash
pnpm exec vitest run packages/ooda/src/api/__tests__/openapi-meta.test.ts
```

Expected: PASS

**Step 5: Run full OODA test suite to verify no regressions**

```bash
pnpm exec turbo run test --filter=@gmacko/ooda --concurrency=1 -- --no-file-parallelism
```

Expected: 414 passed, 9 skipped

**Step 6: Commit**

```bash
git add packages/ooda/src/api/trpc.ts packages/ooda/src/api/__tests__/openapi-meta.test.ts
git commit -m "feat(ooda): wire OpenApiMeta into tRPC init"
```

---

## Task 3: Create OpenAPI Spec Generator for OODA

**Files:**
- Create: `packages/ooda/src/api/openapi.ts`
- Test: `packages/ooda/src/api/__tests__/openapi-spec.test.ts`

**Step 1: Write the failing test**

Create `packages/ooda/src/api/__tests__/openapi-spec.test.ts`:

```typescript
import { describe, expect, it, vi } from "vitest";

vi.mock("@gmacko/ooda/db/client", () => ({ db: {} }));
vi.mock("@gmacko/ooda/db/auth", () => ({
  validateSessionToken: vi.fn(),
  extractSessionToken: vi.fn(),
  SessionNotFoundError: class extends Error {},
}));

describe("OODA OpenAPI spec generation", () => {
  it("generates a valid OpenAPI 3.0.3 document", async () => {
    const { generateOodaOpenApiDocument } = await import("../openapi");
    const doc = generateOodaOpenApiDocument();

    expect(doc.openapi).toBe("3.0.3");
    expect(doc.info.title).toBe("OODA Research API");
    expect(doc.info.version).toBeDefined();
  });

  it("includes security schemes for session and runner auth", async () => {
    const { generateOodaOpenApiDocument } = await import("../openapi");
    const doc = generateOodaOpenApiDocument();

    expect(doc.components?.securitySchemes).toHaveProperty("bearerAuth");
    expect(doc.components?.securitySchemes).toHaveProperty("runnerAuth");
  });

  it("includes paths for annotated procedures", async () => {
    const { generateOodaOpenApiDocument } = await import("../openapi");
    const doc = generateOodaOpenApiDocument();
    const paths = Object.keys(doc.paths ?? {});

    // Should have at least the threads routes once Task 4 annotates them
    expect(paths.length).toBeGreaterThanOrEqual(0);
  });
});
```

**Step 2: Run test to verify it fails**

```bash
pnpm exec vitest run packages/ooda/src/api/__tests__/openapi-spec.test.ts
```

Expected: FAIL — module `../openapi` does not exist.

**Step 3: Create the spec generator**

Create `packages/ooda/src/api/openapi.ts`:

```typescript
import type { OpenAPIV3 } from "openapi-types";
import { generateOpenApiDocument } from "trpc-to-openapi";

import { appRouter } from "./root";

export function generateOodaOpenApiDocument(
  baseUrl = "http://localhost:3001",
): OpenAPIV3.Document {
  return generateOpenApiDocument(appRouter, {
    title: "OODA Research API",
    version: "0.1.0",
    baseUrl,
    securitySchemes: {
      bearerAuth: {
        type: "http",
        scheme: "bearer",
        description: "Session token from better-auth",
      },
      runnerAuth: {
        type: "http",
        scheme: "bearer",
        description: "OODA_RUNNER_SECRET shared secret",
      },
    },
  });
}
```

**Step 4: Run test to verify it passes**

```bash
pnpm exec vitest run packages/ooda/src/api/__tests__/openapi-spec.test.ts
```

Expected: PASS

**Step 5: Add to package exports**

In `packages/ooda/package.json`, add to `"exports"`:

```json
"./api/openapi": "./src/api/openapi.ts"
```

**Step 6: Commit**

```bash
git add packages/ooda/src/api/openapi.ts packages/ooda/src/api/__tests__/openapi-spec.test.ts packages/ooda/package.json
git commit -m "feat(ooda): add OpenAPI spec generator"
```

---

## Task 4: Annotate OODA Threads Router (9 procedures)

**Files:**
- Modify: `packages/ooda/src/api/router/threads.ts`

Add `.meta({ openapi: { ... } })` to each procedure. Queries use GET, mutations use POST. No `.output()` schemas yet — we'll add those in a follow-up.

**Step 1: Annotate all 9 procedures**

The meta annotation goes between the procedure base and `.input()` (or `.query()`/`.mutation()` if no input). Example for the first few:

```typescript
list: publicProcedure
  .meta({ openapi: { method: "GET", path: "/api/threads", tags: ["threads"] } })
  .query(({ ctx }) => { ... }),

byId: publicProcedure
  .meta({ openapi: { method: "GET", path: "/api/threads/by-id", tags: ["threads"] } })
  .input(z.object({ id: z.string() }))
  .query(({ ctx, input }) => { ... }),

bySlug: publicProcedure
  .meta({ openapi: { method: "GET", path: "/api/threads/by-slug", tags: ["threads"] } })
  .input(z.object({ slug: z.string() }))
  .query(({ ctx, input }) => { ... }),

create: authedProcedure
  .meta({ openapi: { method: "POST", path: "/api/threads", tags: ["threads"], protect: true } })
  .input(CreateResearchThreadSchema)
  .mutation(async ({ ctx, input }) => { ... }),

sync: authedProcedure
  .meta({ openapi: { method: "POST", path: "/api/threads/sync", tags: ["threads"], protect: true } })
  .mutation(async ({ ctx }) => { ... }),

updateStatus: authedProcedure
  .meta({ openapi: { method: "POST", path: "/api/threads/update-status", tags: ["threads"], protect: true } })
  .input(z.object({ ... }))
  .mutation(({ ctx, input }) => { ... }),

listNotes: publicProcedure
  .meta({ openapi: { method: "GET", path: "/api/threads/notes", tags: ["threads"] } })
  .input(z.object({ slug: z.string() }))
  .query(({ input }) => { ... }),

listDomainPacks: publicProcedure
  .meta({ openapi: { method: "GET", path: "/api/threads/domain-packs", tags: ["threads"] } })
  .query(() => { ... }),

getDomainPackTemplate: publicProcedure
  .meta({ openapi: { method: "GET", path: "/api/threads/domain-pack-template", tags: ["threads"] } })
  .input(z.object({ packId: z.string() }))
  .query(({ input }) => { ... }),
```

**Step 2: Verify the spec includes threads paths**

```bash
pnpm exec vitest run packages/ooda/src/api/__tests__/openapi-spec.test.ts
```

Then add a targeted assertion to the test:

```typescript
it("includes threads paths after annotation", async () => {
  const { generateOodaOpenApiDocument } = await import("../openapi");
  const doc = generateOodaOpenApiDocument();
  const paths = Object.keys(doc.paths ?? {});
  expect(paths).toContain("/api/threads");
  expect(paths).toContain("/api/threads/by-id");
});
```

**Step 3: Run full OODA tests**

```bash
pnpm exec turbo run test --filter=@gmacko/ooda --concurrency=1 -- --no-file-parallelism
```

Expected: all pass — meta annotations are additive, no behavior change.

**Step 4: Commit**

```bash
git add packages/ooda/src/api/router/threads.ts packages/ooda/src/api/__tests__/openapi-spec.test.ts
git commit -m "feat(ooda): annotate threads router with OpenAPI meta (9 procedures)"
```

---

## Task 5: Annotate OODA Runner Router (14 procedures)

**Files:**
- Modify: `packages/ooda/src/api/router/runner.ts`

**Step 1: Annotate all 14 procedures**

Path convention: `/api/runner/{action}`

```typescript
register:     { method: "POST", path: "/api/runner/register",        tags: ["runner"], protect: true }
heartbeat:    { method: "POST", path: "/api/runner/heartbeat",       tags: ["runner"], protect: true }
listDevices:  { method: "GET",  path: "/api/runner/devices",         tags: ["runner"] }
createSession:{ method: "POST", path: "/api/runner/sessions",        tags: ["runner"], protect: true }
listSessions: { method: "GET",  path: "/api/runner/sessions",        tags: ["runner"] }
listSessionsByRunner: { method: "GET", path: "/api/runner/sessions/by-runner", tags: ["runner"] }
sendPrompt:   { method: "POST", path: "/api/runner/send-prompt",     tags: ["runner"], protect: true }
getSessionEvents: { method: "GET", path: "/api/runner/session-events", tags: ["runner"] }
pushSessionEvent: { method: "POST", path: "/api/runner/session-events", tags: ["runner"], protect: true }
claimSession:     { method: "POST", path: "/api/runner/claim-session",  tags: ["runner"], protect: true }
updateSessionStatus: { method: "POST", path: "/api/runner/update-session-status", tags: ["runner"], protect: true }
getHealth:    { method: "GET",  path: "/api/runner/health",          tags: ["runner"] }
listAdapters: { method: "GET",  path: "/api/runner/adapters",        tags: ["runner"] }
requestPromotion: { method: "POST", path: "/api/runner/request-promotion", tags: ["runner"], protect: true }
```

**Step 2: Run OODA tests**

```bash
pnpm exec turbo run test --filter=@gmacko/ooda --concurrency=1 -- --no-file-parallelism
```

Expected: all pass.

**Step 3: Commit**

```bash
git add packages/ooda/src/api/router/runner.ts
git commit -m "feat(ooda): annotate runner router with OpenAPI meta (14 procedures)"
```

---

## Task 6: Annotate OODA Vault, Publish, Imports Routers (10 procedures)

**Files:**
- Modify: `packages/ooda/src/api/router/vault.ts`
- Modify: `packages/ooda/src/api/router/publish.ts`
- Modify: `packages/ooda/src/api/router/imports.ts`

**Step 1: Annotate vault (6 procedures)**

```typescript
list:    { method: "GET",  path: "/api/vault",         tags: ["vault"] }
read:    { method: "GET",  path: "/api/vault/read",     tags: ["vault"] }
write:   { method: "POST", path: "/api/vault/write",    tags: ["vault"], protect: true }
promote: { method: "POST", path: "/api/vault/promote",  tags: ["vault"], protect: true }
sync:    { method: "POST", path: "/api/vault/sync",     tags: ["vault"], protect: true }
health:  { method: "GET",  path: "/api/vault/health",   tags: ["vault"] }
```

**Step 2: Annotate publish (2 procedures)**

```typescript
draft:      { method: "POST", path: "/api/publish/draft",  tags: ["publish"], protect: true }
listDrafts: { method: "GET",  path: "/api/publish/drafts", tags: ["publish"] }
```

**Step 3: Annotate imports (2 procedures)**

```typescript
normalize:           { method: "POST", path: "/api/imports/normalize",  tags: ["imports"], protect: true }
importConversations: { method: "POST", path: "/api/imports/import",     tags: ["imports"], protect: true }
```

**Step 4: Run tests**

```bash
pnpm exec turbo run test --filter=@gmacko/ooda --concurrency=1 -- --no-file-parallelism
```

**Step 5: Commit**

```bash
git add packages/ooda/src/api/router/vault.ts packages/ooda/src/api/router/publish.ts packages/ooda/src/api/router/imports.ts
git commit -m "feat(ooda): annotate vault, publish, imports routers with OpenAPI meta (10 procedures)"
```

---

## Task 7: Annotate OODA Research Routers (35 procedures across 8 files)

**Files:**
- Modify: `packages/ooda/src/api/router/research/kb.ts`
- Modify: `packages/ooda/src/api/router/research/dives.ts`
- Modify: `packages/ooda/src/api/router/research/memory.ts`
- Modify: `packages/ooda/src/api/router/research/entities.ts`
- Modify: `packages/ooda/src/api/router/research/papers.ts`
- Modify: `packages/ooda/src/api/router/research/graph.ts`
- Modify: `packages/ooda/src/api/router/research/tools.ts`
- Modify: `packages/ooda/src/api/router/research/interests.ts`

Research procedures are spread flat (no nesting), but paths should reflect their logical group.

**Step 1: Annotate kb.ts (12 procedures)**

```typescript
health:         { method: "GET",  path: "/api/research/kb/health",     tags: ["research.kb"] }
searchPapers:   { method: "GET",  path: "/api/research/kb/search",     tags: ["research.kb"] }
listKbs:        { method: "GET",  path: "/api/research/kb",            tags: ["research.kb"] }
getKb:          { method: "GET",  path: "/api/research/kb/get",        tags: ["research.kb"] }
compileKb:      { method: "POST", path: "/api/research/kb/compile",    tags: ["research.kb"], protect: true }
importChats:    { method: "POST", path: "/api/research/kb/import-chats", tags: ["research.kb"], protect: true }
listSources:    { method: "GET",  path: "/api/research/kb/sources",    tags: ["research.kb"] }
embeddingStats: { method: "GET",  path: "/api/research/embeddings/stats", tags: ["research.embeddings"] }
runEmbedding:   { method: "POST", path: "/api/research/embeddings/embed", tags: ["research.embeddings"], protect: true }
runClustering:  { method: "POST", path: "/api/research/embeddings/cluster", tags: ["research.embeddings"], protect: true }
listTopics:     { method: "GET",  path: "/api/research/embeddings/topics", tags: ["research.embeddings"] }
getTopicSources: { method: "GET", path: "/api/research/embeddings/topic-sources", tags: ["research.embeddings"] }
```

**Step 2: Annotate dives.ts (4 procedures)**

```typescript
diveSpawn:    { method: "POST", path: "/api/research/dives/spawn",   tags: ["research.dives"], protect: true }
diveStatus:   { method: "GET",  path: "/api/research/dives/status",  tags: ["research.dives"] }
diveResults:  { method: "GET",  path: "/api/research/dives/results", tags: ["research.dives"] }
divesRecent:  { method: "GET",  path: "/api/research/dives/recent",  tags: ["research.dives"] }
```

**Step 3: Annotate memory.ts (2 procedures)**

```typescript
threadMemorySearch: { method: "GET",  path: "/api/research/memory/search", tags: ["research.memory"] }
threadMemoryUpdate: { method: "POST", path: "/api/research/memory/update", tags: ["research.memory"], protect: true }
```

**Step 4: Annotate entities.ts (3 procedures)**

```typescript
notesByEntity: { method: "GET", path: "/api/research/entities/notes",   tags: ["research.entities"] }
entityIndex:   { method: "GET", path: "/api/research/entities",         tags: ["research.entities"] }
relatedNotes:  { method: "GET", path: "/api/research/entities/related", tags: ["research.entities"] }
```

**Step 5: Annotate papers.ts (2 procedures)**

```typescript
papersSearchVault: { method: "GET", path: "/api/research/papers/search", tags: ["research.papers"] }
paperById:         { method: "GET", path: "/api/research/papers/get",    tags: ["research.papers"] }
```

**Step 6: Annotate graph.ts (4 procedures)**

```typescript
paperNeighborhood: { method: "GET", path: "/api/research/graph/neighborhood", tags: ["research.graph"] }
paperPath:         { method: "GET", path: "/api/research/graph/path",         tags: ["research.graph"] }
graphByThread:     { method: "GET", path: "/api/research/graph/by-thread",    tags: ["research.graph"] }
graphStats:        { method: "GET", path: "/api/research/graph/stats",        tags: ["research.graph"] }
```

**Step 7: Annotate tools.ts (3 procedures)**

```typescript
toolLogsByThread:   { method: "GET",  path: "/api/research/tools/logs",   tags: ["research.tools"] }
toolCallLogInsert:  { method: "POST", path: "/api/research/tools/insert", tags: ["research.tools"], protect: true }
toolCallLogFinish:  { method: "POST", path: "/api/research/tools/finish", tags: ["research.tools"], protect: true }
```

**Step 8: Annotate interests.ts (remaining procedures)**

Count the exact procedures in interests.ts and annotate with:
- Path prefix: `/api/research/interests/`
- Tag: `research.interests`
- Queries → GET, Mutations → POST with `protect: true`

**Step 9: Run full test suite**

```bash
pnpm exec turbo run test --filter=@gmacko/ooda --concurrency=1 -- --no-file-parallelism
```

Expected: all 414 pass.

**Step 10: Update spec test with full path count**

Update `packages/ooda/src/api/__tests__/openapi-spec.test.ts`:

```typescript
it("includes all annotated paths", async () => {
  const { generateOodaOpenApiDocument } = await import("../openapi");
  const doc = generateOodaOpenApiDocument();
  const paths = Object.keys(doc.paths ?? {});
  // 68 procedures, some share paths (GET/POST on same path), expect ~55-65 paths
  expect(paths.length).toBeGreaterThanOrEqual(50);
});
```

**Step 11: Commit**

```bash
git add packages/ooda/src/api/router/research/ packages/ooda/src/api/__tests__/openapi-spec.test.ts
git commit -m "feat(ooda): annotate all 35 research procedures with OpenAPI meta"
```

---

## Task 8: OODA OpenAPI Endpoint

**Files:**
- Create: `apps/ooda/src/app/api/openapi/route.ts`

**Step 1: Create the API route**

Create `apps/ooda/src/app/api/openapi/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { generateOodaOpenApiDocument } from "@gmacko/ooda/api/openapi";

export async function GET() {
  const doc = generateOodaOpenApiDocument({
    baseUrl: process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3001",
  });
  return NextResponse.json(doc);
}
```

Note: `generateOodaOpenApiDocument` needs to accept a config object. Update `packages/ooda/src/api/openapi.ts` to accept `{ baseUrl?: string }` or pass baseUrl directly:

```typescript
export function generateOodaOpenApiDocument(baseUrl = "http://localhost:3001") {
```

Change signature to:

```typescript
export function generateOodaOpenApiDocument(opts: { baseUrl?: string } = {}) {
  const baseUrl = opts.baseUrl ?? "http://localhost:3001";
  // ...
}
```

**Step 2: Test manually**

```bash
cd ~/.config/superpowers/worktrees/gmacko/phase-9-openapi/apps/ooda
pnpm dev &
curl http://localhost:3001/api/openapi | jq '.info'
```

Expected: `{ "title": "OODA Research API", "version": "0.1.0" }`

**Step 3: Commit**

```bash
git add apps/ooda/src/app/api/openapi/route.ts packages/ooda/src/api/openapi.ts
git commit -m "feat(ooda): serve OpenAPI spec at /api/openapi"
```

---

## Task 9: Bob OpenAPI — Extend Existing Generator to Full Router

**Files:**
- Modify: `packages/bob/src/api/src/openapi.ts`
- Create: `packages/bob/src/api/src/contracts/router-openapi.ts`
- Modify: `packages/bob/src/config/src/integrations.ts`

Bob already has a hand-maintained contract-array pattern (`workItemsRestOperations`) that generates OpenAPI from Zod schemas via `z.toJSONSchema()`. This works without modifying Bob's `initTRPC` call or annotating procedures.

**Strategy:** Extend Bob's existing pattern by writing a utility that walks the tRPC router tree and extracts procedure metadata (name, input schema, type). This avoids the need to add `.meta()` annotations to 200+ Bob procedures.

**Step 1: Create router introspection utility**

Create `packages/bob/src/api/src/contracts/router-openapi.ts`:

```typescript
import { z } from "zod/v4";
import type { OpenAPIV3_1 } from "openapi-types";

interface ProcedureInfo {
  path: string;
  type: "query" | "mutation";
  tag: string;
  inputSchema?: z.ZodTypeAny;
}

function extractProcedures(
  router: Record<string, unknown>,
  prefix = "",
  tag = "",
): ProcedureInfo[] {
  const results: ProcedureInfo[] = [];
  for (const [key, value] of Object.entries(router)) {
    const val = value as Record<string, unknown>;
    if (val?._def?.type === "query" || val?._def?.type === "mutation") {
      results.push({
        path: prefix ? `${prefix}.${key}` : key,
        type: val._def.type as "query" | "mutation",
        tag: tag || prefix || "default",
        inputSchema: val._def?.inputs?.[0] as z.ZodTypeAny | undefined,
      });
    } else if (val?._def?.router === true || val?._def?.procedures) {
      // Nested router
      const nested = val._def.procedures ?? val;
      results.push(
        ...extractProcedures(
          nested as Record<string, unknown>,
          prefix ? `${prefix}.${key}` : key,
          prefix ? `${prefix}.${key}` : key,
        ),
      );
    }
  }
  return results;
}

function toRestPath(procedurePath: string): string {
  return `/api/v1/${procedurePath.replace(/\./g, "/").replace(/([A-Z])/g, "-$1").toLowerCase()}`;
}

export function generateFullApiDocument(
  router: Record<string, unknown>,
  config: { title: string; version: string; baseUrl: string },
): OpenAPIV3_1.Document {
  const procedures = extractProcedures(router);
  const paths: Record<string, OpenAPIV3_1.PathItemObject> = {};
  const tags = new Set<string>();

  for (const proc of procedures) {
    const method = proc.type === "query" ? "get" : "post";
    const restPath = toRestPath(proc.path);
    tags.add(proc.tag);

    const operation: OpenAPIV3_1.OperationObject = {
      tags: [proc.tag],
      operationId: proc.path,
      summary: proc.path,
      responses: {
        "200": { description: "Successful response" },
        "401": { description: "Unauthorized" },
      },
    };

    if (proc.inputSchema) {
      try {
        const jsonSchema = z.toJSONSchema(proc.inputSchema) as OpenAPIV3_1.SchemaObject;
        if (method === "get") {
          // For GET, input becomes query parameters
          operation.parameters = Object.entries(
            (jsonSchema.properties ?? {}) as Record<string, OpenAPIV3_1.SchemaObject>,
          ).map(([name, schema]) => ({
            name,
            in: "query" as const,
            required: (jsonSchema.required as string[] ?? []).includes(name),
            schema,
          }));
        } else {
          operation.requestBody = {
            required: true,
            content: { "application/json": { schema: jsonSchema } },
          };
        }
      } catch {
        // Schema conversion failed — skip input definition
      }
    }

    paths[restPath] = { ...paths[restPath], [method]: operation };
  }

  return {
    openapi: "3.1.0",
    info: { title: config.title, version: config.version },
    servers: [{ url: config.baseUrl }],
    paths,
    components: {
      securitySchemes: {
        bearerAuth: { type: "http", scheme: "bearer" },
        cookieAuth: { type: "apiKey", in: "cookie", name: "better-auth.session_token" },
      },
    },
    tags: [...tags].sort().map((t) => ({ name: t })),
  };
}
```

**Step 2: Update openapi.ts to use both generators**

Modify `packages/bob/src/api/src/openapi.ts` to merge the existing work-items spec with the auto-generated full spec:

```typescript
import { generateFullApiDocument } from "./contracts/router-openapi";
import { appRouterRecord } from "./root"; // the raw record, not the wrapped router

// Keep existing generateApiDocument for work-items
// Add new function for full API
export function generateFullBobApiDocument(
  config: Partial<OpenApiConfig> = {},
): OpenAPIV3_1.Document {
  const mergedConfig = { ...defaultConfig, ...config };
  return generateFullApiDocument(appRouterRecord, {
    title: mergedConfig.title,
    version: mergedConfig.version,
    baseUrl: mergedConfig.baseUrl,
  });
}
```

**Step 3: Enable OpenAPI by default**

In `packages/bob/src/config/src/integrations.ts`, change:

```typescript
openapi: true,
```

**Step 4: Update the endpoint to use the full generator**

In `apps/bob/src/app/api/openapi/route.ts` (if it exists in the CF Workers app, adapt accordingly):

```typescript
import { generateFullBobApiDocument } from "@bob/api/openapi";

export async function GET() {
  return NextResponse.json(
    generateFullBobApiDocument({ baseUrl: "https://blder.bot" }),
  );
}
```

**Step 5: Run Bob tests**

```bash
pnpm exec turbo run test --filter=@bob/api --concurrency=1 -- --no-file-parallelism
```

**Step 6: Commit**

```bash
git add packages/bob/src/api/src/contracts/router-openapi.ts packages/bob/src/api/src/openapi.ts packages/bob/src/config/src/integrations.ts
git commit -m "feat(bob): auto-generate full OpenAPI spec from tRPC router tree"
```

---

## Task 10: Build-Time Spec Generation Script

**Files:**
- Create: `scripts/generate-openapi.ts`

A build script that generates `openapi.json` files for both OODA and Bob, suitable for CI and client codegen.

**Step 1: Create the script**

```typescript
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

async function main() {
  const outDir = join(process.cwd(), "dist", "openapi");
  mkdirSync(outDir, { recursive: true });

  // OODA spec
  const { generateOodaOpenApiDocument } = await import("@gmacko/ooda/api/openapi");
  const oodaSpec = generateOodaOpenApiDocument({ baseUrl: "https://ooda.blder.bot" });
  writeFileSync(join(outDir, "ooda.json"), JSON.stringify(oodaSpec, null, 2));
  console.log(`Wrote ${Object.keys(oodaSpec.paths ?? {}).length} OODA paths → dist/openapi/ooda.json`);

  // Bob spec
  const { generateFullBobApiDocument } = await import("@bob/api/openapi");
  const bobSpec = generateFullBobApiDocument({ baseUrl: "https://bob.blder.bot" });
  writeFileSync(join(outDir, "bob.json"), JSON.stringify(bobSpec, null, 2));
  console.log(`Wrote ${Object.keys(bobSpec.paths ?? {}).length} Bob paths → dist/openapi/bob.json`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

**Step 2: Add script to root package.json**

```json
"scripts": {
  "generate:openapi": "tsx scripts/generate-openapi.ts"
}
```

**Step 3: Test it**

```bash
pnpm generate:openapi
cat dist/openapi/ooda.json | jq '.info'
cat dist/openapi/bob.json | jq '.info'
```

**Step 4: Add dist/openapi to .gitignore**

```
dist/openapi/
```

**Step 5: Commit**

```bash
git add scripts/generate-openapi.ts package.json .gitignore
git commit -m "feat: add build-time OpenAPI spec generation script"
```

---

## Task 11: Client Generation Packages

**Files:**
- Create: `packages/ooda-client/package.json`
- Create: `packages/ooda-client/src/index.ts`
- Create: `packages/bob-client/package.json`
- Create: `packages/bob-client/src/index.ts`

These packages use `openapi-fetch` for typed HTTP clients generated from the OpenAPI specs.

**Step 1: Install openapi-typescript and openapi-fetch**

```bash
pnpm add -w -D openapi-typescript
pnpm add -F @gmacko/ooda-client openapi-fetch
pnpm add -F @gmacko/bob-client openapi-fetch
```

**Step 2: Create ooda-client package**

`packages/ooda-client/package.json`:

```json
{
  "name": "@gmacko/ooda-client",
  "private": true,
  "version": "0.0.0",
  "type": "module",
  "exports": {
    ".": "./src/index.ts"
  },
  "scripts": {
    "generate": "pnpm generate:openapi && openapi-typescript dist/openapi/ooda.json -o src/schema.d.ts"
  },
  "dependencies": {
    "openapi-fetch": "catalog:"
  }
}
```

`packages/ooda-client/src/index.ts`:

```typescript
import createClient from "openapi-fetch";
import type { paths } from "./schema";

export function createOodaClient(baseUrl = "https://ooda.blder.bot") {
  return createClient<paths>({ baseUrl });
}

export type { paths };
```

**Step 3: Create bob-client package** (same pattern)

`packages/bob-client/package.json` and `packages/bob-client/src/index.ts` — same structure, different name and base URL (`https://bob.blder.bot`).

**Step 4: Generate initial schemas**

```bash
pnpm generate:openapi
pnpm exec openapi-typescript dist/openapi/ooda.json -o packages/ooda-client/src/schema.d.ts
pnpm exec openapi-typescript dist/openapi/bob.json -o packages/bob-client/src/schema.d.ts
```

**Step 5: Verify typecheck**

```bash
pnpm exec turbo run typecheck --filter=@gmacko/ooda-client --filter=@gmacko/bob-client
```

**Step 6: Commit**

```bash
git add packages/ooda-client/ packages/bob-client/
git commit -m "feat: add typed OpenAPI client packages for OODA and Bob"
```

---

## Task 12: Research Sidecar OpenAPI Export

**Files:**
- Create: `scripts/export-sidecar-openapi.sh`

The Python FastAPI sidecar already generates OpenAPI natively. Add a script to fetch and store it alongside the tRPC-generated specs.

**Step 1: Create export script**

```bash
#!/usr/bin/env bash
set -euo pipefail

# Requires the sidecar to be running on port 8000
SIDECAR_URL="${RESEARCH_API_URL:-http://localhost:8000}"

mkdir -p dist/openapi
curl -sf "$SIDECAR_URL/openapi.json" > dist/openapi/research-sidecar.json
echo "Wrote research sidecar spec → dist/openapi/research-sidecar.json"
```

**Step 2: Make executable and commit**

```bash
chmod +x scripts/export-sidecar-openapi.sh
git add scripts/export-sidecar-openapi.sh
git commit -m "feat: add research sidecar OpenAPI export script"
```

---

## Summary

| Task | Scope | Procedures |
|------|-------|------------|
| 1 | Dependencies | — |
| 2 | tRPC meta wiring | — |
| 3 | Spec generator | — |
| 4 | Threads router | 9 |
| 5 | Runner router | 14 |
| 6 | Vault + publish + imports | 10 |
| 7 | Research (8 files) | 35 |
| 8 | OODA /api/openapi endpoint | — |
| 9 | Bob full spec generator | ~200+ |
| 10 | Build-time script | — |
| 11 | Client packages | — |
| 12 | Research sidecar export | — |

Total: 68 OODA procedures annotated, ~200+ Bob procedures auto-discovered, 3 OpenAPI specs (OODA, Bob, research sidecar), 2 typed client packages.
