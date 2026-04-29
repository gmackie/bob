# Phase 8A: OODA Mechanical Migration

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Copy OODA's full codebase (`/Volumes/dev/ooda/`) into the gmacko monorepo, folding 14 `@ooda/*` packages into `@gmacko/ooda/` subpaths, wiring tRPC into `apps/ooda/`, and placing the Python research-backend as a standalone service. Zero functional changes — OODA runs identically on its existing stack (tRPC, Drizzle, separate DB schema) inside the gmacko workspace.

**Architecture:** Same playbook as Bob's 7B-1a mechanical copy. OODA packages become subpaths under `packages/ooda/src/<area>/`. The web app's pages, components, and tRPC client setup move into the existing `apps/ooda/` skeleton (created in 7B-1b). The runner, CLI, and mobile apps copy as `apps/ooda-runner/`, `apps/ooda-cli/`, `apps/ooda-mobile/`. Python sidecar stays at `packages/research-backend/`. Schema convergence (adding tenantId FKs, merging with `@gmacko/core/db`) and runner convergence happen in Phase 8B. tRPC → Effect-RPC conversion is Phase 8C.

**Tech Stack:** pnpm workspaces, tRPC v11.7, Drizzle ORM 0.45, Next.js 16, Vitest 4, Python/FastAPI (research-backend), Zod v4

---

## Locked decisions (from design session 2026-04-25)

| # | Decision |
|---|---|
| 1 | **Phase 8A = mechanical copy, zero refactor.** OODA runs unchanged on tRPC inside gmacko. |
| 2 | **14 packages → `packages/ooda/src/<area>/` subpaths.** Same flat layout as 7B-0 consolidation. |
| 3 | **`apps/ooda/` gets the full web app.** Existing skeleton (layout, pages, rpc client) gets replaced by OODA's actual web app stack (tRPC client, components, pages). |
| 4 | **Python research-backend → `packages/research-backend/`.** Stays as a standalone uv-managed Python package. Not a pnpm workspace member. |
| 5 | **OODA keeps its own DB connection + schema.** No merging with `@gmacko/core/db` until Phase 8B. `packages/ooda/src/db/` has its own client, schema, migrations. |
| 6 | **Runner copies as `apps/ooda-runner/`.** Runs OODA's existing runner protocol (shared-secret auth, Codex/Claude adapters). Runner convergence with `@gmacko/core/runner-base` WorkHandlers happens in Phase 8B. |
| 7 | **`@ooda/ui` merges into `@gmacko/core/ui`.** OODA's UI components (button, dropdown, field, input, label, separator, toast, theme) become part of the shared component library. |
| 8 | **Tooling packages (`@ooda/{eslint-config,prettier-config,tsconfig,vitest-config,tailwind-config}`) are NOT copied.** Consumers repoint to `@gmacko/{eslint,prettier,typescript,tailwind}` tooling equivalents. |

---

## Phase roadmap

| Sub-phase | Scope | Plan |
|---|---|---|
| **8A** | Mechanical copy: packages, apps, Python sidecar, import rewrite | **THIS DOC** |
| 8B | Schema migration (tables → `@gmacko/core/db`, add tenantId FKs), runner convergence (OODA adapters → gmacko WorkHandlers), retire placeholder thread/branch/message tables | future plan |
| 8C | tRPC → Effect-RPC conversion for all OODA routers | future plan |

---

## Pre-work: worktree

```bash
git worktree add ~/.config/superpowers/worktrees/gmacko/phase-8a-ooda -b phase-8a-ooda master
cd ~/.config/superpowers/worktrees/gmacko/phase-8a-ooda
pnpm install
```

All subsequent task commands run from the worktree root unless otherwise noted.

---

## Source inventory

### OODA packages → `packages/ooda/src/<area>/`

| Source (`/Volumes/dev/ooda/packages/`) | Target (`packages/ooda/src/`) | Subpath export |
|---|---|---|
| `thread-model/src/` | `thread-model/` | `./thread-model` |
| `provenance/src/` | `provenance/` | `./provenance` |
| `capability-registry/src/` | `capability-registry/` | `./capability-registry` |
| `runner-protocol/src/` | `runner-protocol/` | `./runner-protocol` |
| `source-connectors/src/` | `source-connectors/` | `./source-connectors` |
| `imports/src/` | `imports/` | `./imports` |
| `domain-packs/src/` | `domain-packs/` | `./domain-packs` |
| `buddy-tools/src/` | `buddy-tools/` | `./buddy-tools` |
| `vault/src/` | `vault/` | `./vault` |
| `agent-adapters/src/` | `agent-adapters/` | `./agent-adapters` |
| `db/src/` | `db/` | `./db`, `./db/client`, `./db/schema`, `./db/auth`, `./db/listen-broker` |
| `api/src/` | `api/` | `./api` |

Already in `packages/ooda/src/` from 7B-1b:
- `wiki/` → `./wiki`
- `ext/` → `./ext`

### OODA apps → `apps/`

| Source (`/Volumes/dev/ooda/apps/`) | Target (`apps/`) |
|---|---|
| `web/src/` | `ooda/` (replace skeleton) |
| `runner/src/` | `ooda-runner/` (new) |
| `cli/src/` | `ooda-cli/` (new) |
| `mobile/` | `ooda-mobile/` (new, Expo) |

### Python sidecar

| Source | Target |
|---|---|
| `/Volumes/dev/ooda/packages/research-backend/` | `packages/research-backend/` |

### OODA tRPC routers (all live in `packages/ooda/src/api/`)

Root: `appRouter` with 6 namespaces: `threads`, `runner`, `research`, `vault`, `publish`, `imports`.

`research` is spread-composed from 8 sub-routers: `kb`, `dives`, `memory`, `entities`, `papers`, `graph`, `tools`, `interests`.

### OODA DB tables (all live in `packages/ooda/src/db/schema/`)

**research.ts:** `research_thread`, `runner_device`, `runner_session`, `provenance_event`, `session_event`

**research-buddy.ts:** `note_index`, `note_entity`, `graph_exploration`, `thread_memory`, `thread_link`, `tool_call_log`

**vault-taxonomy.ts:** Per-vault schema factory (`personal_vault.*`, `research_vault.*`): `sources`, `embeddings`, `topics`, `source_topics`, `kbs`, `kb_sources`, `import_jobs`, `graph_node`, `graph_edge`, `standing_interest`, `findings_inbox`, `s2_cache`

**auth.ts:** `users`, `sessions` (OODA's own, separate from gmacko's better-auth)

---

## Import rewrite rules

All files copied from OODA need systematic import rewrites:

| Old import | New import |
|---|---|
| `from "@ooda/db"` | `from "@gmacko/ooda/db"` |
| `from "@ooda/db/client"` | `from "@gmacko/ooda/db/client"` |
| `from "@ooda/db/schema"` | `from "@gmacko/ooda/db/schema"` |
| `from "@ooda/db/auth"` | `from "@gmacko/ooda/db/auth"` |
| `from "@ooda/db/listen-broker"` | `from "@gmacko/ooda/db/listen-broker"` |
| `from "@ooda/api"` | `from "@gmacko/ooda/api"` |
| `from "@ooda/thread-model"` | `from "@gmacko/ooda/thread-model"` |
| `from "@ooda/thread-workspace"` | `from "@gmacko/ooda/thread-workspace"` |
| `from "@ooda/provenance"` | `from "@gmacko/ooda/provenance"` |
| `from "@ooda/capability-registry"` | `from "@gmacko/ooda/capability-registry"` |
| `from "@ooda/runner-protocol"` | `from "@gmacko/ooda/runner-protocol"` |
| `from "@ooda/source-connectors"` | `from "@gmacko/ooda/source-connectors"` |
| `from "@ooda/imports"` | `from "@gmacko/ooda/imports"` |
| `from "@ooda/domain-packs"` | `from "@gmacko/ooda/domain-packs"` |
| `from "@ooda/buddy-tools"` | `from "@gmacko/ooda/buddy-tools"` |
| `from "@ooda/vault"` | `from "@gmacko/ooda/vault"` |
| `from "@ooda/agent-adapters"` | `from "@gmacko/ooda/agent-adapters"` |
| `from "@ooda/ui"` | `from "@gmacko/core/ui"` (after Task 6 merge) |
| `from "zod/v4"` | `from "zod"` (gmacko uses zod ^4.1.12 natively) |

Tooling imports are deleted entirely — they're replaced by gmacko workspace equivalents:
- `@ooda/eslint-config` → `@gmacko/eslint` (in tooling/bob-eslint)
- `@ooda/prettier-config` → `@gmacko/prettier` (in tooling/bob-prettier)
- `@ooda/tsconfig` → `@gmacko/tsconfig` (in tooling/bob-typescript)
- `@ooda/vitest-config` → inline vitest config or `@gmacko/vitest` if exists
- `@ooda/tailwind-config` → `@gmacko/tailwind` (in tooling/tailwind)

---

### Task 0: Worktree + baseline (5 min)

**Files:**
- Read: `packages/ooda/package.json`, `packages/ooda/src/index.ts`

**Step 1: Create worktree**

```bash
git worktree add ~/.config/superpowers/worktrees/gmacko/phase-8a-ooda -b phase-8a-ooda master
cd ~/.config/superpowers/worktrees/gmacko/phase-8a-ooda
pnpm install
```

**Step 2: Capture baseline test counts**

```bash
pnpm test 2>&1 | tail -30
```

Expected: all existing tests pass (core, bob, ooda wiki/linker tests).

**Step 3: Verify apps/ooda skeleton exists**

```bash
ls apps/ooda/src/app/layout.tsx
ls packages/ooda/src/wiki/index.ts
```

Expected: both exist from 7B-1b.

**Step 4: Commit**

```bash
git commit --allow-empty -m "chore: begin Phase 8A — OODA mechanical migration"
```

**Verification:** Worktree green, baseline captured.

---

### Task 1: Copy pure-data packages (batch 1 of 4)

Copy 6 packages with no `@ooda/*` cross-dependencies (leaf nodes in the dependency graph):

- `thread-model` — Zod schemas for thread/note/artifact shapes
- `provenance` — Zod schemas for provenance events
- `capability-registry` — Capability definitions (can_codex, can_claude, etc.)
- `runner-protocol` — Runner↔server message types
- `source-connectors` — Connector base class + normalization types
- `imports` — Import job types + processors

**Files:**
- Copy: `/Volumes/dev/ooda/packages/thread-model/src/` → `packages/ooda/src/thread-model/`
- Copy: `/Volumes/dev/ooda/packages/provenance/src/` → `packages/ooda/src/provenance/`
- Copy: `/Volumes/dev/ooda/packages/capability-registry/src/` → `packages/ooda/src/capability-registry/`
- Copy: `/Volumes/dev/ooda/packages/runner-protocol/src/` → `packages/ooda/src/runner-protocol/`
- Copy: `/Volumes/dev/ooda/packages/source-connectors/src/` → `packages/ooda/src/source-connectors/`
- Copy: `/Volumes/dev/ooda/packages/imports/src/` → `packages/ooda/src/imports/`
- Modify: `packages/ooda/package.json` — add 6 subpath exports

**Step 1: Copy source directories**

```bash
OODA=/Volumes/dev/ooda/packages
TARGET=packages/ooda/src

for pkg in thread-model provenance capability-registry runner-protocol source-connectors imports; do
  cp -r "$OODA/$pkg/src/" "$TARGET/$pkg/"
done
```

**Step 2: Add subpath exports to `packages/ooda/package.json`**

Add to the `"exports"` map:

```json
"./thread-model": "./src/thread-model/index.ts",
"./provenance": "./src/provenance/index.ts",
"./capability-registry": "./src/capability-registry/index.ts",
"./runner-protocol": "./src/runner-protocol/index.ts",
"./source-connectors": "./src/source-connectors/index.ts",
"./imports": "./src/imports/index.ts"
```

**Step 3: Rewrite imports in copied files**

```bash
# These packages use `from "zod/v4"` — rewrite to `from "zod"` (gmacko's zod is ^4.1.12)
find packages/ooda/src/{thread-model,provenance,capability-registry,runner-protocol,source-connectors,imports} \
  -name "*.ts" -exec sed -i '' 's|from "zod/v4"|from "zod"|g' {} +
```

These 6 packages have no `@ooda/*` cross-dependencies, so only `zod/v4` rewrites are needed.

**Step 4: Add missing dependencies to `packages/ooda/package.json`**

Check each package's `package.json` for non-workspace deps. Expected additions:
- `simple-git` (used by source-connectors)
- `gray-matter` (already present)

```bash
cd packages/ooda && pnpm add simple-git
```

**Step 5: Typecheck**

```bash
cd packages/ooda && pnpm typecheck
```

Expected: clean. Fix any issues from import paths or missing types.

**Step 6: Run tests**

```bash
pnpm test
```

Expected: existing tests pass + any tests that came with the copied packages.

**Step 7: Commit**

```bash
git add packages/ooda/
git commit -m "feat(ooda): copy pure-data packages — thread-model, provenance, capability-registry, runner-protocol, source-connectors, imports (Phase 8A batch 1)"
```

---

### Task 2: Copy domain packages (batch 2 of 4)

Copy 4 packages that depend on batch 1 packages:

- `domain-packs` — depends on `capability-registry`
- `vault` — depends on `gray-matter`, `simple-git`
- `buddy-tools` — depends on `api`, `db` (will need stubs until batch 3)
- `agent-adapters` — depends on `buddy-tools`, `capability-registry`, `node-pty`

**Files:**
- Copy: `/Volumes/dev/ooda/packages/domain-packs/src/` → `packages/ooda/src/domain-packs/`
- Copy: `/Volumes/dev/ooda/packages/vault/src/` → `packages/ooda/src/vault/`
- Copy: `/Volumes/dev/ooda/packages/buddy-tools/src/` → `packages/ooda/src/buddy-tools/`
- Copy: `/Volumes/dev/ooda/packages/agent-adapters/src/` → `packages/ooda/src/agent-adapters/`
- Modify: `packages/ooda/package.json` — add 4 subpath exports + deps

**Step 1: Copy source directories**

```bash
OODA=/Volumes/dev/ooda/packages
TARGET=packages/ooda/src

for pkg in domain-packs vault buddy-tools agent-adapters; do
  cp -r "$OODA/$pkg/src/" "$TARGET/$pkg/"
done
```

**Step 2: Add subpath exports**

```json
"./domain-packs": "./src/domain-packs/index.ts",
"./vault": "./src/vault/index.ts",
"./buddy-tools": "./src/buddy-tools/index.ts",
"./agent-adapters": "./src/agent-adapters/index.ts"
```

**Step 3: Rewrite all `@ooda/*` imports**

```bash
find packages/ooda/src/{domain-packs,vault,buddy-tools,agent-adapters} -name "*.ts" -exec sed -i '' \
  -e 's|from "@ooda/capability-registry"|from "@gmacko/ooda/capability-registry"|g' \
  -e 's|from "@ooda/thread-model"|from "@gmacko/ooda/thread-model"|g' \
  -e 's|from "@ooda/provenance"|from "@gmacko/ooda/provenance"|g' \
  -e 's|from "@ooda/runner-protocol"|from "@gmacko/ooda/runner-protocol"|g' \
  -e 's|from "@ooda/buddy-tools"|from "@gmacko/ooda/buddy-tools"|g' \
  -e 's|from "@ooda/api"|from "@gmacko/ooda/api"|g' \
  -e 's|from "@ooda/db|from "@gmacko/ooda/db|g' \
  -e 's|from "zod/v4"|from "zod"|g' \
  {} +
```

**Step 4: Add deps**

```bash
cd packages/ooda && pnpm add node-pty @anthropic-ai/sdk
```

**Step 5: Typecheck — expect errors from `@gmacko/ooda/api` and `@gmacko/ooda/db` (not copied yet)**

This is expected. buddy-tools and agent-adapters depend on api/db which arrive in Task 3. Note the errors but proceed — they resolve after batch 3.

**Step 6: Commit**

```bash
git add packages/ooda/
git commit -m "feat(ooda): copy domain packages — domain-packs, vault, buddy-tools, agent-adapters (Phase 8A batch 2)"
```

---

### Task 3: Copy DB package (batch 3 of 4)

The DB package is OODA's schema layer — tables, client, migrations, auth helpers. It stays self-contained in `packages/ooda/src/db/` with its own Postgres connection. Phase 8B will merge tables into `@gmacko/core/db`.

**Files:**
- Copy: `/Volumes/dev/ooda/packages/db/src/` → `packages/ooda/src/db/`
- Copy: `/Volumes/dev/ooda/packages/db/drizzle.config.ts` → `packages/ooda/drizzle.config.ts`
- Copy: `/Volumes/dev/ooda/packages/db/drizzle/` → `packages/ooda/drizzle/` (migration files)
- Modify: `packages/ooda/package.json` — add 5 subpath exports + deps

**Step 1: Copy source + config**

```bash
cp -r /Volumes/dev/ooda/packages/db/src/ packages/ooda/src/db/
cp /Volumes/dev/ooda/packages/db/drizzle.config.ts packages/ooda/drizzle.config.ts
# Copy migrations if they exist
if [ -d /Volumes/dev/ooda/packages/db/drizzle ]; then
  cp -r /Volumes/dev/ooda/packages/db/drizzle/ packages/ooda/drizzle/
fi
```

**Step 2: Add subpath exports**

```json
"./db": "./src/db/index.ts",
"./db/client": "./src/db/client.ts",
"./db/schema": "./src/db/schema.ts",
"./db/auth": "./src/db/auth.ts",
"./db/listen-broker": "./src/db/listen-broker.ts"
```

**Step 3: Rewrite imports**

```bash
find packages/ooda/src/db -name "*.ts" -exec sed -i '' \
  -e 's|from "zod/v4"|from "zod"|g' \
  {} +
```

The DB package has no `@ooda/*` imports (it's a leaf), so only `zod/v4` rewrites are needed.

**Step 4: Add deps**

```bash
cd packages/ooda && pnpm add drizzle-orm drizzle-zod postgres
cd packages/ooda && pnpm add -D drizzle-kit dotenv-cli tsx
```

**Step 5: Update drizzle.config.ts**

The config path needs to point to the new schema location. Edit `packages/ooda/drizzle.config.ts`:
- Schema path: `"./src/db/schema"` or `"./src/db/schema.ts"`
- Out: `"./drizzle"`

**Step 6: Add DB scripts to package.json**

```json
"db:push": "dotenv -e ../../.env -- drizzle-kit push",
"db:migrate": "dotenv -e ../../.env -- drizzle-kit migrate",
"db:studio": "dotenv -e ../../.env -- drizzle-kit studio",
"db:seed": "dotenv -e ../../.env -- tsx src/db/seed.ts"
```

**Step 7: Typecheck**

```bash
cd packages/ooda && pnpm typecheck
```

Expected: clean for db/. Some batch-2 packages (buddy-tools, agent-adapters) should now resolve their `@gmacko/ooda/db` imports.

**Step 8: Commit**

```bash
git add packages/ooda/
git commit -m "feat(ooda): copy DB package — schema, client, migrations, auth helpers (Phase 8A batch 3)"
```

---

### Task 4: Copy API package (batch 4 of 4)

The API package contains tRPC routers, middleware (vault-scope, env validation), and sidecar client helpers. This is the largest package (~40 procedures across 6 namespaced routers).

**Files:**
- Copy: `/Volumes/dev/ooda/packages/api/src/` → `packages/ooda/src/api/`
- Modify: `packages/ooda/package.json` — add api subpath + deps

**Step 1: Copy source**

```bash
cp -r /Volumes/dev/ooda/packages/api/src/ packages/ooda/src/api/
```

**Step 2: Add subpath export**

```json
"./api": "./src/api/index.ts"
```

**Step 3: Rewrite all `@ooda/*` imports across the API source**

```bash
find packages/ooda/src/api -name "*.ts" -exec sed -i '' \
  -e 's|from "@ooda/db|from "@gmacko/ooda/db|g' \
  -e 's|from "@ooda/thread-model"|from "@gmacko/ooda/thread-model"|g' \
  -e 's|from "@ooda/thread-workspace"|from "@gmacko/ooda/thread-workspace"|g' \
  -e 's|from "@ooda/domain-packs"|from "@gmacko/ooda/domain-packs"|g' \
  -e 's|from "@ooda/imports"|from "@gmacko/ooda/imports"|g' \
  -e 's|from "@ooda/vault"|from "@gmacko/ooda/vault"|g' \
  -e 's|from "zod/v4"|from "zod"|g' \
  {} +
```

**Step 4: Add deps**

```bash
cd packages/ooda && pnpm add @trpc/server superjson
```

**Step 5: Typecheck**

```bash
cd packages/ooda && pnpm typecheck
```

Expected: all 14 packages now resolve. Fix any remaining import issues.

**Step 6: Run tests**

```bash
cd packages/ooda && pnpm test
```

Expected: existing wiki/linker tests pass + any API tests that came over.

**Step 7: Commit**

```bash
git add packages/ooda/
git commit -m "feat(ooda): copy API package — tRPC routers, middleware, sidecar clients (Phase 8A batch 4)"
```

---

### Task 5: Wire tRPC into `apps/ooda/`

Replace the existing Effect-RPC client in `apps/ooda/` with OODA's tRPC setup. Add the `api/trpc/[trpc]/route.ts` handler and the React provider.

**Files:**
- Create: `apps/ooda/src/app/api/trpc/[trpc]/route.ts`
- Create: `apps/ooda/src/trpc/react.tsx`
- Create: `apps/ooda/src/trpc/query-client.ts`
- Create: `apps/ooda/src/trpc/server.tsx`
- Modify: `apps/ooda/src/app/layout.tsx` — swap `GmackoAppProviders` for `TRPCReactProvider`
- Modify: `apps/ooda/package.json` — add tRPC deps
- Remove: `apps/ooda/src/rpc/` (Effect-RPC client — replaced by tRPC)

**Step 1: Create tRPC route handler**

Write `apps/ooda/src/app/api/trpc/[trpc]/route.ts`:

```typescript
import type { NextRequest } from "next/server";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { appRouter, createTRPCContext } from "@gmacko/ooda/api";

const setCorsHeaders = (res: Response) => {
  res.headers.set("Access-Control-Allow-Origin", "*");
  res.headers.set("Access-Control-Request-Method", "*");
  res.headers.set("Access-Control-Allow-Methods", "OPTIONS, GET, POST");
  res.headers.set("Access-Control-Allow-Headers", "*");
};

export const OPTIONS = () => {
  const response = new Response(null, { status: 204 });
  setCorsHeaders(response);
  return response;
};

const handler = async (req: NextRequest) => {
  const response = await fetchRequestHandler({
    endpoint: "/api/trpc",
    router: appRouter,
    req,
    createContext: () => createTRPCContext({ headers: req.headers }),
    onError({ error, path }) {
      console.error(`>>> tRPC Error on '${path}'`, error);
    },
  });
  setCorsHeaders(response);
  return response;
};

export { handler as GET, handler as POST };
```

**Step 2: Copy tRPC client setup from OODA web app**

```bash
mkdir -p apps/ooda/src/trpc
cp /Volumes/dev/ooda/apps/web/src/trpc/react.tsx apps/ooda/src/trpc/react.tsx
cp /Volumes/dev/ooda/apps/web/src/trpc/query-client.ts apps/ooda/src/trpc/query-client.ts
cp /Volumes/dev/ooda/apps/web/src/trpc/server.tsx apps/ooda/src/trpc/server.tsx
```

**Step 3: Rewrite imports in tRPC client files**

```bash
find apps/ooda/src/trpc -name "*.ts" -o -name "*.tsx" | xargs sed -i '' \
  -e 's|from "@ooda/api"|from "@gmacko/ooda/api"|g'
```

**Step 4: Update layout.tsx**

Replace the `GmackoAppProviders` wrapper with `TRPCReactProvider`. The layout should import from `../trpc/react` and wrap children.

**Step 5: Remove old RPC client**

```bash
rm -rf apps/ooda/src/rpc/
```

**Step 6: Add tRPC dependencies to `apps/ooda/package.json`**

```bash
cd apps/ooda && pnpm add @gmacko/ooda@workspace:* @trpc/client @trpc/server @trpc/tanstack-react-query @tanstack/react-query superjson
```

(Note: `@gmacko/ooda` should already be a dependency; just ensure tRPC deps are present.)

**Step 7: Typecheck + build**

```bash
cd apps/ooda && pnpm typecheck
cd apps/ooda && pnpm build
```

**Step 8: Commit**

```bash
git add apps/ooda/
git commit -m "feat(ooda): wire tRPC handler + client into apps/ooda (Phase 8A Task 5)"
```

---

### Task 6: Merge `@ooda/ui` into `@gmacko/core/ui`

OODA's UI package has 8 component files (button, dropdown-menu, field, input, label, separator, theme, toast) built on Radix + CVA + Tailwind. These merge into `@gmacko/core/ui` which uses the same stack.

**Files:**
- Copy: `/Volumes/dev/ooda/packages/ui/src/` → `packages/core/src/ui/ooda/` (namespaced to avoid conflicts)
- Modify: `packages/core/package.json` — add `./ui/ooda` subpath if needed
- Modify: All OODA files that `import from "@ooda/ui"` → `from "@gmacko/core/ui"`

**Step 1: Audit for conflicts**

Check which component names overlap between `@ooda/ui` and `@gmacko/core/ui`:

```bash
ls /Volumes/dev/ooda/packages/ui/src/
ls packages/core/src/ui/
```

If no conflicts, copy directly into `packages/core/src/ui/`. If conflicts exist (likely — button, input, label are common), namespace under `packages/core/src/ui/ooda/` temporarily and re-export from the ui barrel.

**Step 2: Copy components**

```bash
cp -r /Volumes/dev/ooda/packages/ui/src/* packages/core/src/ui/
```

Or if namespaced:

```bash
mkdir -p packages/core/src/ui/ooda
cp -r /Volumes/dev/ooda/packages/ui/src/* packages/core/src/ui/ooda/
```

**Step 3: Rewrite `@ooda/ui` imports across all copied OODA source**

```bash
find packages/ooda/src -name "*.ts" -o -name "*.tsx" | xargs sed -i '' \
  -e 's|from "@ooda/ui|from "@gmacko/core/ui|g'

find apps/ooda/src -name "*.ts" -o -name "*.tsx" | xargs sed -i '' \
  -e 's|from "@ooda/ui|from "@gmacko/core/ui|g'
```

**Step 4: Add required deps to `@gmacko/core`**

```bash
cd packages/core && pnpm add sonner tailwind-merge class-variance-authority
```

(Check which are already present first.)

**Step 5: Typecheck**

```bash
cd packages/core && pnpm typecheck
cd packages/ooda && pnpm typecheck
```

**Step 6: Commit**

```bash
git add packages/core/ packages/ooda/ apps/ooda/
git commit -m "feat(ui): merge @ooda/ui components into @gmacko/core/ui (Phase 8A Task 6)"
```

---

### Task 7: Copy web app pages + components

Copy OODA's actual web UI (pages, components, hooks, styles) from `apps/web/` into `apps/ooda/`. The skeleton from 7B-1b gets replaced with the real implementation.

**Files:**
- Copy: `/Volumes/dev/ooda/apps/web/src/app/` → `apps/ooda/src/app/` (overwrite skeleton pages)
- Copy: `/Volumes/dev/ooda/apps/web/src/components/` → `apps/ooda/src/components/`
- Copy: `/Volumes/dev/ooda/apps/web/src/hooks/` → `apps/ooda/src/hooks/` (if exists)
- Copy: `/Volumes/dev/ooda/apps/web/src/lib/` → `apps/ooda/src/lib/` (if exists)
- Copy: `/Volumes/dev/ooda/apps/web/tailwind.config.ts` → `apps/ooda/tailwind.config.ts` (if exists)
- Copy: `/Volumes/dev/ooda/apps/web/postcss.config.mjs` → `apps/ooda/postcss.config.mjs` (if exists)
- Modify: All copied files — rewrite `@ooda/*` imports

**Step 1: List what exists in OODA web app**

```bash
find /Volumes/dev/ooda/apps/web/src -type d | head -30
```

**Step 2: Copy app pages (preserving the tRPC route handler from Task 5)**

```bash
# Back up our tRPC handler
cp apps/ooda/src/app/api/trpc/\[trpc\]/route.ts /tmp/ooda-trpc-route.ts

# Copy pages, but not the entire app dir (preserve layout changes from Task 5)
# Copy individual page directories
for dir in /Volumes/dev/ooda/apps/web/src/app/*/; do
  dirname=$(basename "$dir")
  if [ "$dirname" != "api" ]; then
    cp -r "$dir" "apps/ooda/src/app/$dirname/"
  fi
done

# Copy the root page.tsx
cp /Volumes/dev/ooda/apps/web/src/app/page.tsx apps/ooda/src/app/page.tsx

# Restore tRPC handler
mkdir -p apps/ooda/src/app/api/trpc/\[trpc\]/
cp /tmp/ooda-trpc-route.ts apps/ooda/src/app/api/trpc/\[trpc\]/route.ts
```

**Step 3: Copy components, hooks, lib**

```bash
# Copy if they exist
[ -d /Volumes/dev/ooda/apps/web/src/components ] && cp -r /Volumes/dev/ooda/apps/web/src/components/ apps/ooda/src/components/
[ -d /Volumes/dev/ooda/apps/web/src/hooks ] && cp -r /Volumes/dev/ooda/apps/web/src/hooks/ apps/ooda/src/hooks/
[ -d /Volumes/dev/ooda/apps/web/src/lib ] && cp -r /Volumes/dev/ooda/apps/web/src/lib/ apps/ooda/src/lib/
```

**Step 4: Copy config files**

```bash
[ -f /Volumes/dev/ooda/apps/web/tailwind.config.ts ] && cp /Volumes/dev/ooda/apps/web/tailwind.config.ts apps/ooda/tailwind.config.ts
[ -f /Volumes/dev/ooda/apps/web/postcss.config.mjs ] && cp /Volumes/dev/ooda/apps/web/postcss.config.mjs apps/ooda/postcss.config.mjs
```

**Step 5: Rewrite all imports**

```bash
find apps/ooda/src -name "*.ts" -o -name "*.tsx" | xargs sed -i '' \
  -e 's|from "@ooda/api"|from "@gmacko/ooda/api"|g' \
  -e 's|from "@ooda/db|from "@gmacko/ooda/db|g' \
  -e 's|from "@ooda/ui|from "@gmacko/core/ui|g' \
  -e 's|from "@ooda/thread-model"|from "@gmacko/ooda/thread-model"|g' \
  -e 's|from "zod/v4"|from "zod"|g'
```

**Step 6: Update globals.css**

Copy OODA's globals.css (Tailwind directives, custom properties):

```bash
cp /Volumes/dev/ooda/apps/web/src/app/globals.css apps/ooda/src/app/globals.css
```

**Step 7: Add web-specific deps**

```bash
cd apps/ooda && pnpm add reagraph
```

**Step 8: Typecheck + build**

```bash
cd apps/ooda && pnpm typecheck
cd apps/ooda && pnpm build
```

**Step 9: Commit**

```bash
git add apps/ooda/
git commit -m "feat(ooda): copy web app pages, components, and styles (Phase 8A Task 7)"
```

---

### Task 8: Copy Python research-backend

The research-backend is a standalone Python FastAPI service. It lives outside the pnpm workspace and has its own `pyproject.toml`, `uv.lock`, Dockerfile.

**Files:**
- Copy: `/Volumes/dev/ooda/packages/research-backend/` → `packages/research-backend/`
- Create: `packages/research-backend/.env.example` (if not present in source)

**Step 1: Copy entire directory**

```bash
cp -r /Volumes/dev/ooda/packages/research-backend/ packages/research-backend/
```

**Step 2: Remove Python caches**

```bash
find packages/research-backend -type d -name __pycache__ -exec rm -rf {} + 2>/dev/null
find packages/research-backend -type d -name "*.egg-info" -exec rm -rf {} + 2>/dev/null
find packages/research-backend -name ".pytest_cache" -exec rm -rf {} + 2>/dev/null
```

**Step 3: Verify Python env**

```bash
cd packages/research-backend && uv sync
```

**Step 4: Run Python tests**

```bash
cd packages/research-backend && uv run pytest
```

Expected: all tests pass (63+ tests).

**Step 5: Run linter**

```bash
cd packages/research-backend && uv run ruff check .
```

**Step 6: Verify it starts**

```bash
cd packages/research-backend && timeout 5 uv run uvicorn research_backend.main:app --port 8000 || true
```

Expected: starts successfully (timeout kills it after 5s).

**Step 7: Add to `.gitignore`**

Ensure `packages/research-backend/.venv/` and `packages/research-backend/__pycache__/` are in the workspace `.gitignore`.

**Step 8: Commit**

```bash
git add packages/research-backend/
git commit -m "feat(ooda): copy Python research-backend sidecar (Phase 8A Task 8)"
```

---

### Task 9: Copy runner app

Copy OODA's runner process as `apps/ooda-runner/`. This is a long-lived Node process that registers with the API, claims work (sessions), and executes agent adapters (Codex CLI via node-pty, Claude API).

**Files:**
- Copy: `/Volumes/dev/ooda/apps/runner/` → `apps/ooda-runner/`
- Modify: `apps/ooda-runner/package.json` — rename, rewrite deps

**Step 1: Copy runner app**

```bash
cp -r /Volumes/dev/ooda/apps/runner/ apps/ooda-runner/
rm -rf apps/ooda-runner/node_modules apps/ooda-runner/dist
```

**Step 2: Update `package.json`**

- Rename to `@gmacko/ooda-runner`
- Replace all `@ooda/*` deps with `@gmacko/ooda/*`:

| Old dep | New dep |
|---|---|
| `@ooda/agent-adapters` | removed (now a subpath of `@gmacko/ooda`) |
| `@ooda/api` | removed (now a subpath) |
| `@ooda/capability-registry` | removed |
| `@ooda/domain-packs` | removed |
| `@ooda/provenance` | removed |
| `@ooda/runner-protocol` | removed |
| `@ooda/thread-model` | removed |
| `@ooda/thread-workspace` | removed |

All become imports from `@gmacko/ooda/<subpath>`. The only dep needed is `@gmacko/ooda: "workspace:*"`.

Keep non-workspace deps: `@trpc/client`, `superjson`, `zod`.

**Step 3: Rewrite imports**

```bash
find apps/ooda-runner/src -name "*.ts" | xargs sed -i '' \
  -e 's|from "@ooda/agent-adapters"|from "@gmacko/ooda/agent-adapters"|g' \
  -e 's|from "@ooda/api"|from "@gmacko/ooda/api"|g' \
  -e 's|from "@ooda/capability-registry"|from "@gmacko/ooda/capability-registry"|g' \
  -e 's|from "@ooda/domain-packs"|from "@gmacko/ooda/domain-packs"|g' \
  -e 's|from "@ooda/provenance"|from "@gmacko/ooda/provenance"|g' \
  -e 's|from "@ooda/runner-protocol"|from "@gmacko/ooda/runner-protocol"|g' \
  -e 's|from "@ooda/thread-model"|from "@gmacko/ooda/thread-model"|g' \
  -e 's|from "@ooda/thread-workspace"|from "@gmacko/ooda/thread-workspace"|g' \
  -e 's|from "zod/v4"|from "zod"|g'
```

**Step 4: Replace tooling devDeps**

Remove `@ooda/{eslint-config,prettier-config,tsconfig,vitest-config}`. Add gmacko equivalents.

**Step 5: Typecheck**

```bash
cd apps/ooda-runner && pnpm typecheck
```

**Step 6: Commit**

```bash
git add apps/ooda-runner/
git commit -m "feat(ooda): copy runner app as apps/ooda-runner (Phase 8A Task 9)"
```

---

### Task 10: Copy CLI app (optional)

Copy OODA's CLI tool as `apps/ooda-cli/`. Lower priority — the CLI is a thin wrapper around thread-workspace operations.

**Files:**
- Copy: `/Volumes/dev/ooda/apps/cli/` → `apps/ooda-cli/`
- Modify: `apps/ooda-cli/package.json` — rename, rewrite deps

**Step 1: Copy and clean**

```bash
cp -r /Volumes/dev/ooda/apps/cli/ apps/ooda-cli/
rm -rf apps/ooda-cli/node_modules apps/ooda-cli/dist
```

**Step 2: Update package.json**

- Rename to `@gmacko/ooda-cli`
- Replace `@ooda/thread-workspace` → import from `@gmacko/ooda/thread-workspace`
- Update bin entry if present

**Step 3: Rewrite imports**

```bash
find apps/ooda-cli/src -name "*.ts" | xargs sed -i '' \
  -e 's|from "@ooda/thread-workspace"|from "@gmacko/ooda/thread-workspace"|g' \
  -e 's|from "zod/v4"|from "zod"|g'
```

**Step 4: Typecheck**

```bash
cd apps/ooda-cli && pnpm typecheck
```

**Step 5: Commit**

```bash
git add apps/ooda-cli/
git commit -m "feat(ooda): copy CLI app as apps/ooda-cli (Phase 8A Task 10)"
```

---

### Task 11: Environment + dev workflow setup

Set up the development environment so `pnpm dev` starts both OODA's Next.js app and the Python sidecar. Add OODA-specific env vars to the gmacko `.env.example`.

**Files:**
- Modify: `.env.example` — add OODA env vars
- Modify: `turbo.json` — add ooda-runner pipeline if needed
- Create: root-level npm script aliases for OODA dev

**Step 1: Add OODA env vars to `.env.example`**

Append:

```bash
# OODA
OODA_STORAGE_ROOT=~/.ooda/threads/
RESEARCH_API_URL=http://localhost:8000
PERSONAL_VAULT_PATH=
RESEARCH_VAULT_PATH=
```

**Step 2: Update turbo.json**

Ensure `apps/ooda` and `apps/ooda-runner` are included in the `dev` and `build` pipelines. Turbo should auto-discover them from `pnpm-workspace.yaml` but verify.

**Step 3: Add root scripts to `package.json`**

```json
"dev:ooda": "turbo dev --filter=@gmacko/ooda-web",
"dev:ooda-runner": "cd apps/ooda-runner && tsx watch src/index.ts",
"dev:research": "cd packages/research-backend && uv run uvicorn research_backend.main:app --reload --port 8000"
```

**Step 4: Test dev startup**

```bash
pnpm dev:ooda
```

Expected: Next.js starts on port 3001, tRPC endpoints accessible.

**Step 5: Commit**

```bash
git add .env.example turbo.json package.json
git commit -m "chore(ooda): add env vars, turbo pipeline, dev scripts (Phase 8A Task 11)"
```

---

### Task 12: Full verification + CLAUDE.md update

End-to-end verification that the migrated OODA runs correctly inside the gmacko monorepo.

**Files:**
- Modify: `CLAUDE.md` — update with OODA migration status

**Step 1: Typecheck everything**

```bash
pnpm turbo run typecheck
```

Expected: all packages and apps pass.

**Step 2: Run all tests**

```bash
pnpm turbo run test
```

Expected: all existing tests pass + OODA package tests pass.

**Step 3: Build apps/ooda**

```bash
cd apps/ooda && pnpm build
```

Expected: Next.js build succeeds.

**Step 4: Verify Python tests**

```bash
cd packages/research-backend && uv run pytest
```

Expected: 63+ tests pass.

**Step 5: Smoke test tRPC endpoints**

Start `apps/ooda` dev server, hit `/api/trpc/threads.list` to verify the tRPC handler is wired:

```bash
cd apps/ooda && timeout 10 pnpm dev &
sleep 5
curl -s http://localhost:3001/api/trpc/threads.list | head -20
kill %1
```

**Step 6: Update CLAUDE.md**

Add Phase 8A migration status. Note which packages live where, that OODA uses tRPC (not Effect-RPC), and that the Python sidecar is at `packages/research-backend/`.

**Step 7: Final commit**

```bash
git add .
git commit -m "docs: Phase 8A verification complete — OODA mechanical migration done"
```

---

## Phase 8B outline (future plan)

Phase 8B migrates OODA's schema into `@gmacko/core/db` and converges the runner. Not detailed here — will get its own plan.

| Task | Scope |
|---|---|
| 8B-1 | Migrate `research_thread` → `@gmacko/core/db/schema` with `tenantId` FK to `tenants` |
| 8B-2 | Migrate research-buddy tables (note_index, note_entity, graph_exploration, etc.) |
| 8B-3 | Migrate vault-taxonomy schema factory |
| 8B-4 | Migrate auth tables (merge with better-auth or remove) |
| 8B-5 | Runner convergence: OODA's Codex/Claude adapters → gmacko WorkHandlers |
| 8B-6 | Remove gmacko's placeholder thread/branch/message tables |
| 8B-7 | Update all OODA routers to use `@gmacko/core/db/client` instead of `@gmacko/ooda/db/client` |
| 8B-8 | Verification + retire `packages/ooda/src/db/` |

## Phase 8C outline (future plan)

Phase 8C converts OODA's tRPC routers to Effect-RPC. Not detailed here.

| Task | Scope |
|---|---|
| 8C-1 | Define Effect-RPC contracts for OODA procedures in `@gmacko/core/contracts` |
| 8C-2 | Implement Effect-RPC handlers, one router at a time |
| 8C-3 | Update `apps/ooda/` to use Effect-RPC client |
| 8C-4 | Remove tRPC dependencies |
