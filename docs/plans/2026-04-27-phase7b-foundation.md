# Phase 7B Foundation Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** Restructure the gmacko monorepo for Bob + OODA migration. Consolidate 32 existing `@gmacko/*` packages into three namespaced packages (`@gmacko/core`, `@gmacko/bob`, `@gmacko/ooda`); copy Bob's source from `/Volumes/dev/bob/` into `apps/bob/` + `packages/bob/`; promote OODA-specific code out of `apps/web` into `apps/ooda/` and rename `apps/web/` → `apps/core/` as gmacko's reference / agent-harness app.

**Architecture:** Three pnpm workspace packages with flat subpaths — `@gmacko/core` (shared), `@gmacko/bob` (Bob domain), `@gmacko/ooda` (OODA domain). Six apps eventually: `apps/{core,bob,ooda,mobile-core,mobile-bob,mobile-ooda}` plus possibly desktops and Bob's secondary services. Drizzle schemas co-located with services. Greenfield — no data migration from existing Bob (blder.bot on hetzner-master stays separate).

**Tech Stack:** pnpm workspaces, Effect 4.0.0-beta.43, Effect-RPC, Drizzle ORM 0.44, better-auth 1.4.0-beta.9, Next.js 16 (apps/core, apps/ooda), Vite + Cloudflare Workers (apps/bob — initially; converted to Next.js in a later sub-phase), Expo 55 (mobile apps), Electron (desktop apps).

---

## Locked decisions (from grilling 2026-04-27)

| # | Decision |
|---|---|
| 1 | Migration sequence: **Phase 7B = Bob full migration; Phase 7C = OODA full repo migration**. OODA continues consuming gmacko services via Path C2 stubs throughout 7B. |
| 2 | **Big-bang copy** approach: Bob's source moves into the gmacko monorepo wholesale; Bob's existing repo gets archived once 7B is done. |
| 3 | **7B-1 = mechanical copy, zero refactor.** Bob runs unchanged on its old stack inside the monorepo until 7B-2+ migrations begin. |
| 4 | OODA = **promote-and-strip** from `apps/web`. `apps/web` becomes `apps/core` (gmacko's agent harness for chatting with CLI LLM agents + smoke-test infra). |
| 5 | Migration order inside Phase 7B: **foundation-first** (DB → Auth → Domain → Realtime → Agent → Runner → UI → Retire). |
| 6 | **Greenfield** — no data migration from blder.bot (the old Bob on hetzner-master). |
| 7 | **Three consolidated packages** with subpaths: `@gmacko/{core,bob,ooda}`. NOT prefix-named (e.g. `@gmacko/core-auth`). |
| 8 | **Flat layout** in `@gmacko/core/src/<pkg>/` (NOT grouped by concern). |
| 9 | **Drizzle schemas co-located** with services (`packages/<ns>/src/<area>/schema.ts`); `db/schema.ts` is a barrel re-exporter; apps assemble combined schemas in their own `drizzle.config.ts`. |
| 10 | **Themes co-located** with components in `@gmacko/core/ui`; web+mobile share UI components via NativeWind. |
| 11 | **7B-0 staged commits** (7 batches): one batch per concern cluster, each leaves the workspace green. |
| 12 | **Six apps eventually**: `apps/{core,bob,ooda,mobile-core,mobile-bob,mobile-ooda}` (desktops deferred; Bob's secondary services land separately). |
| 13 | Realtime per architecture_direction: **Redis (prod) / ws-gateway (self-host) / memory (dev)** — already chosen; Bob's Pusher gets retired in 7B-5. |

---

## Phase 7B roadmap

The full Phase 7B is multi-week. This document fully details only **7B-0** and **7B-1** (the consolidation + product copies), which is this session's scope. Sub-phases 7B-2..9 are sketched here for context; each will get its own detailed plan when we reach it.

| Sub-phase | What it does | Detailed plan |
|---|---|---|
| **7B-0** | Consolidate 32 `@gmacko/*` packages into `@gmacko/core` (+ `@gmacko/ooda` for `wiki`/`ext-ooda`). Flat layout in `packages/core/src/<pkg>/`. 7 staged batches. Apps' deps + transpilePackages updated. All tests green throughout. | **THIS DOC** |
| **7B-1a** | Mechanical copy of `/Volumes/dev/bob/` into the monorepo. `apps/blder` → `apps/bob/` (Vite + CF Workers, untouched). `apps/{mobile,desktop,bob-server,ws-gateway,execution}` → respective new dirs. 27 `@bob/*` packages → `packages/bob/src/<area>/` subpaths. Bob runs end-to-end on its old stack inside gmacko. | **THIS DOC** |
| **7B-1b** | OODA promote-and-strip from `apps/web`. Move OODA routes/components/RPC client → `apps/ooda/`. Rename `apps/web/` → `apps/core/`. Rename `apps/mobile/` → `apps/mobile-core/`. Move `packages/wiki/` → `packages/ooda/src/wiki/`. Move `packages/ext-ooda/` → `packages/ooda/src/ext/`. | **THIS DOC** |
| 7B-2 | DB schema merge: Bob's tables move into `@gmacko/bob/<area>/schema.ts`; gmacko's tables stay in `@gmacko/core/<area>/schema.ts`; combined drizzle config in `apps/bob/drizzle.config.ts`. Greenfield — no data migration. | future plan |
| 7B-3 | Auth migration: Bob retires its own `betterAuth(...)` instance, points at `@gmacko/core/auth`'s `initAuth`. Bob's GitHub OAuth + email/password flow consume gmacko's tenant bootstrap. | future plan |
| 7B-? | **Bob web stack rewrite (Vite → Next.js).** `apps/bob/` rewrites to Next.js so it can consume `@gmacko/core/app-shell`. Sequenced before 7B-8 (UI migration). | future plan |
| 7B-4 | Domain services: `@bob/work-items` → `@gmacko/bob/work-items` Effect-RPC contracts; `@bob/api` tRPC routers retire; `@bob/payments`+`@bob/purchases` → `@gmacko/core/billing`; `@bob/api-forgegraph` → `@gmacko/bob/api-forgegraph`. | future plan |
| 7B-5 | Realtime: Bob's Pusher (`@bob/realtime`) retires; consumers move to `@gmacko/core/realtime` with Redis (prod) backend. `@bob/ws` retires; `@gmacko/core/ws-gateway` (already in-tree) takes over. | future plan |
| 7B-6 | Agent: Bob's agent runtime (`@bob/agents` + `@bob/execution-lib`) retires; consumers move to `@gmacko/core/agent` (CLI subprocess orchestrator). Bob's `task_runs` model binds to gmacko agent sessions. | future plan |
| 7B-7 | Runner: Bob's runner protocol (`@bob/agent-toolkit` if applicable) → `@gmacko/core/runner-protocol` + `@gmacko/core/runner-base`. | future plan |
| 7B-8 | UI: `@bob/ui` (Bob's Shadcn/Radix wrappers) merge into `@gmacko/core/ui`; Bob's app shell → `@gmacko/core/app-shell` consumer. | future plan |
| 7B-9 | Retirement: drop `@bob/legacy`, archive `/Volumes/dev/bob/`, remove redundant `@bob/*` packages, tag `phase-7b-complete`. | future plan |

Phase 7C (OODA full repo migration) follows the same shape, ported from `/Volumes/dev/gmacko/apps/ooda/` — already inside the monorepo after 7B-1b — onto `@gmacko/core` + `@gmacko/ooda`.

---

## Pre-work: worktree

This plan executes in a worktree per the project's worktree convention.

```
git worktree add ~/.config/superpowers/worktrees/gmacko/phase-7b-foundation -b phase-7b-foundation master
cd ~/.config/superpowers/worktrees/gmacko/phase-7b-foundation
pnpm install
```

All subsequent task commands run from the worktree root unless otherwise noted.

---

# Phase 7B-0: Consolidation (7 batches)

The current 32 `@gmacko/*` packages collapse into `@gmacko/core` (30 packages) and `@gmacko/ooda` (2 packages: `wiki` + `ext-ooda` — the ext-ooda is also OODA-specific per its name). `@gmacko/bob` is created empty here (populated in 7B-1a).

Existing packages to move:
- **Core (30):** `agent`, `agent-toolkit`, `analytics`, `app-shell`, `auth`, `billing`, `client`, `config`, `contracts`, `cookies`, `db`, `desktop-shell`, `email`, `i18n`, `mcp-server`, `mobile-shell`, `models`, `monitoring`, `notifications`, `projects`, `realtime`, `rpc`, `runner-base`, `runner-protocol`, `secrets`, `settings`, `storage`, `ui`, `validators`, `ws-gateway`
- **OODA (2):** `wiki`, `ext-ooda`

Existing apps (status):
- `apps/web/` — kept; renamed in 7B-1b.
- `apps/mobile/` — kept; renamed in 7B-1b.
- `apps/desktop/` — kept (deferred — possibly renamed `apps/desktop-core/` in a later sub-phase).
- `apps/server/` — stale (only `dist/` + `node_modules/`, no `package.json`); deleted in Task 0.

### Task 0: Worktree + sanity (10 min)

**Steps:**

1. Create the worktree per Pre-work section above.
2. Run `pnpm test 2>&1 | tail -20` from the worktree root. Capture baseline test counts (auth 70, agent 33, etc.).
3. Run `cd apps/web && pnpm test -- smoke 2>&1 | tail -10` to confirm smoke 9/9 baseline.
4. Delete `apps/server/`:
   ```bash
   rm -rf apps/server/
   ```
5. Commit: `chore: drop stale apps/server (no package.json, leftover from Phase 6 transitional layout)`

**Verification:** `pnpm install` clean; baseline test counts captured for retro.

---

### Task 1: Create `packages/core/` shell (Batch 0)

**Files:**
- Create: `packages/core/package.json`
- Create: `packages/core/tsconfig.json`
- Create: `packages/core/vitest.config.ts`
- Create: `packages/core/README.md`
- Create: `packages/core/src/.gitkeep`

**Step 1: Write `packages/core/package.json`:**

```json
{
  "name": "@gmacko/core",
  "private": true,
  "version": "0.0.0",
  "type": "module",
  "exports": {
    ".": "./src/index.ts"
  },
  "scripts": {
    "test": "vitest run --passWithNoTests",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "effect": "4.0.0-beta.43"
  },
  "devDependencies": {
    "@gmacko/tsconfig": "workspace:*",
    "@effect/vitest": "4.0.0-beta.43",
    "@types/node": "25.6.0",
    "typescript": "^5.9.0",
    "vitest": "^3.0.0"
  }
}
```

The `exports` map starts with just `.`; subsequent batches add subpath entries (`./auth`, `./db`, etc.) as packages move in.

**Step 2: Write `packages/core/tsconfig.json`** matching existing `@gmacko/auth/tsconfig.json` pattern (`extends: "@gmacko/tsconfig/base.json"`, includes `src`).

**Step 3: Write `packages/core/vitest.config.ts`:**

```typescript
import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    name: "@gmacko/core",
    include: ["src/**/__tests__/**/*.test.ts", "src/**/*.test.ts"],
  },
});
```

**Step 4: Write `packages/core/src/index.ts`:**

```typescript
// @gmacko/core barrel — populated incrementally in Phase 7B-0 batches.
// See subpath exports for the actual surfaces:
//   import { Sessions } from "@gmacko/core/auth";
//   import { GmackoDb } from "@gmacko/core/db";
//   etc.
//
// The root export intentionally exposes nothing — consumers should
// import from specific subpaths so tree-shaking + dependency tracking
// stays accurate.
export {};
```

**Step 5: Create `packages/ooda/` mirror** with the same shell (name `@gmacko/ooda`).

**Step 6: Create `packages/bob/` shell** (name `@gmacko/bob`) — empty, populated in 7B-1a.

**Step 7: `pnpm install` from workspace root.** Confirms three new workspace packages are recognized.

**Step 8: Run `pnpm test`** — should still pass everything that passed before (we added empty packages, removed nothing).

**Step 9: Commit:**

```
git add packages/core/ packages/ooda/ packages/bob/
git commit -m "feat(workspace): create @gmacko/{core,bob,ooda} shells for Phase 7B-0 consolidation"
```

---

### Task 2: Batch 1 — Foundation packages (`validators`, `config`, `cookies`, `i18n`, `settings`)

These have **zero internal `@gmacko/*` deps**, so they're the safest to move first.

**Files affected:**
- Move: `packages/{validators,config,cookies,i18n,settings}/src/` → `packages/core/src/{validators,config,cookies,i18n,settings}/`
- Delete: `packages/{validators,config,cookies,i18n,settings}/` (entire dirs)
- Update: `packages/core/package.json` exports map (add 5 subpaths)
- Update: `packages/core/package.json` deps (merge in any deps the moved packages had)
- Update: every `import` statement across the workspace from `@gmacko/<pkg>` → `@gmacko/core/<pkg>` for each of the 5 packages
- Update: `apps/web/next.config.ts` `transpilePackages` list (drop the 5 moved packages, leave `@gmacko/core`)
- Update: `apps/mobile` and `apps/desktop` package.json deps if they referenced any of the 5

**Step 1: For each package in `{validators, config, cookies, i18n, settings}`:**
1. `git mv packages/<pkg>/src packages/core/src/<pkg>` (preserves history)
2. If the package had `__tests__/`, ensure they came along (they're inside `src/`).
3. Read the package's `package.json` and merge any unique `dependencies` into `packages/core/package.json`. Skip duplicates (`effect` is already there).
4. Delete `packages/<pkg>/` entirely (including its `package.json`, `tsconfig.json`, `vitest.config.ts`, `node_modules`).

**Step 2: Update `packages/core/package.json` exports:**

```json
"exports": {
  ".": "./src/index.ts",
  "./validators": "./src/validators/index.ts",
  "./config": "./src/config/index.ts",
  "./cookies": "./src/cookies/index.ts",
  "./i18n": "./src/i18n/index.ts",
  "./settings": "./src/settings/index.ts"
}
```

**Step 3: Codemod imports across workspace:**

```bash
# For each moved package, rewrite imports.
for pkg in validators config cookies i18n settings; do
  find apps packages -type f \( -name "*.ts" -o -name "*.tsx" \) \
    -not -path "*/node_modules/*" \
    -exec sed -i '' "s|from \"@gmacko/${pkg}\"|from \"@gmacko/core/${pkg}\"|g" {} +
  find apps packages -type f \( -name "*.ts" -o -name "*.tsx" \) \
    -not -path "*/node_modules/*" \
    -exec sed -i '' "s|from \"@gmacko/${pkg}/|from \"@gmacko/core/${pkg}/|g" {} +
done
```

**Step 4: Update `packages/core/src/index.ts`** to optionally re-export the new subpaths (or leave it empty — subpath imports work without root re-exports). Recommended: leave empty.

**Step 5: Update consumer `package.json` deps:**
- For each package/app that depended on `@gmacko/<moved-pkg>`, change the dep to `@gmacko/core` if it's not already there.
- Use `grep -l "@gmacko/validators\|@gmacko/config\|..." apps/*/package.json packages/*/package.json` to find them.

**Step 6: Update `apps/web/next.config.ts`** `transpilePackages` list — remove `@gmacko/{validators, config, cookies, i18n, settings}`, ensure `@gmacko/core` is listed.

**Step 7: `pnpm install` from root.** Resolves the new dep graph.

**Step 8: Run `pnpm test`.** All previously-passing tests should still pass. Specifically run the smoke test: `cd apps/web && pnpm test -- smoke`.

**Step 9: Commit:**

```
git add -A
git commit -m "refactor(workspace): batch 1 — move @gmacko/{validators,config,cookies,i18n,settings} into @gmacko/core subpaths"
```

---

### Task 3: Batch 2 — DB-adjacent foundations (`db`, `storage`, `monitoring`, `analytics`)

Same pattern as Task 2. Order matters: `db` is the foundation; `storage`, `monitoring`, `analytics` depend on common runtime services but not on each other.

**Files affected:**
- Move: `packages/{db,storage,monitoring,analytics}/src/` → `packages/core/src/{db,storage,monitoring,analytics}/`
- Delete: those packages' dirs.
- Update: `packages/core/package.json` exports (+4) and deps (drizzle-orm, pglite, etc. from `db`).
- Update: imports across workspace.
- Update: app-level `next.config.ts` and `serverExternalPackages` if needed.

**Special note for `db`:** the `db` package has multiple subpath exports already (`./schema/auth`, `./schema/tenancy`, `./migrate`, `./client`). Preserve them under `@gmacko/core/db/*`:

```json
"./db": "./src/db/index.ts",
"./db/schema/auth": "./src/db/schema/auth.ts",
"./db/schema/tenancy": "./src/db/schema/tenancy.ts",
"./db/migrate": "./src/db/migrate.ts"
```

(Or whatever the existing `packages/db/package.json` exports map looks like — preserve every entry, just nested under `db/`.)

**Steps follow Task 2 pattern (move, codemod, update exports, install, test, commit).**

**Commit message:** `refactor(workspace): batch 2 — move @gmacko/{db,storage,monitoring,analytics} into @gmacko/core subpaths`

---

### Task 4: Batch 3 — Services (`auth`, `secrets`, `projects`, `billing`, `email`, `notifications`)

These all depend on `db` (already moved in batch 2). Move in this order so each settles cleanly.

**Critical for `auth`:** preserve every existing subpath export. `@gmacko/auth` has at least:
- `.` (barrel)
- `./errors` (from Phase 7A)
- `./middleware`
- `./client`

Map to `@gmacko/core/auth`, `@gmacko/core/auth/errors`, `@gmacko/core/auth/middleware`, `@gmacko/core/auth/client`.

Same for `@gmacko/secrets/errors`, `@gmacko/projects/errors` (Phase 7A errors-subpath refactor).

**Codemod must preserve the trailing subpath:**
```bash
sed -i '' "s|from \"@gmacko/auth\"|from \"@gmacko/core/auth\"|g" ...
sed -i '' "s|from \"@gmacko/auth/|from \"@gmacko/core/auth/|g" ...
```

The second pattern handles `from "@gmacko/auth/errors"` → `from "@gmacko/core/auth/errors"`.

**Steps follow Task 2 pattern.**

**Commit message:** `refactor(workspace): batch 3 — move @gmacko/{auth,secrets,projects,billing,email,notifications} into @gmacko/core subpaths`

---

### Task 5: Batch 4 — RPC layer (`contracts`, `client`, `rpc`)

`contracts` defines the Effect-RPC groups. `client` is the typed SDK. `rpc` is the AuthMiddleware/CurrentUser context infrastructure.

**Critical:** `@gmacko/rpc` has subpath exports `./context`, `./errors` (per the auth middleware imports). Preserve:

```json
"./rpc": "./src/rpc/index.ts",
"./rpc/context": "./src/rpc/context.ts",
"./rpc/errors": "./src/rpc/errors.ts"
```

**`@gmacko/contracts`** has groups + stubs subpaths:
```json
"./contracts": "./src/contracts/index.ts",
"./contracts/stubs": "./src/contracts/stubs/index.ts"
```

(Preserve actual existing exports map structure.)

**Steps follow Task 2 pattern.**

**Commit message:** `refactor(workspace): batch 4 — move @gmacko/{contracts,client,rpc} into @gmacko/core subpaths`

---

### Task 6: Batch 5 — Runtime (`realtime`, `ws-gateway`, `runner-protocol`, `runner-base`, `mcp-server`, `agent`, `agent-toolkit`)

**`@gmacko/realtime`** has backend subpaths (`./memory`, `./redis`, `./ws-gateway`?). Preserve all.

**`@gmacko/agent`** has `./errors` (from Phase 7A). Preserve.

**Steps follow Task 2 pattern.**

**Commit message:** `refactor(workspace): batch 5 — move @gmacko/{realtime,ws-gateway,runner-protocol,runner-base,mcp-server,agent,agent-toolkit} into @gmacko/core subpaths`

---

### Task 7: Batch 6 — UI (`ui`, `app-shell`, `mobile-shell`, `desktop-shell`, `models`)

`@gmacko/ui` has component subpaths (e.g. `./button`, `./shell`). `@gmacko/app-shell` has provider/component subpaths. `@gmacko/mobile-shell` is the RN equivalent. `@gmacko/desktop-shell` is Electron.

`models` is the basic domain types package (per `apps/web/package.json`).

**Steps follow Task 2 pattern.**

**Commit message:** `refactor(workspace): batch 6 — move @gmacko/{ui,app-shell,mobile-shell,desktop-shell,models} into @gmacko/core subpaths`

---

### Task 8: Batch 7 — OODA-specific packages (`wiki`, `ext-ooda`)

These are the two packages that move to `@gmacko/ooda`, NOT `@gmacko/core`.

**Files affected:**
- Move: `packages/wiki/src/` → `packages/ooda/src/wiki/`
- Move: `packages/ext-ooda/src/` → `packages/ooda/src/ext/`
- Delete: `packages/wiki/`, `packages/ext-ooda/`
- Update: `packages/ooda/package.json` exports map (+2 subpaths: `./wiki`, `./ext`)
- Update: imports across workspace from `@gmacko/wiki` → `@gmacko/ooda/wiki`, `@gmacko/ext-ooda` → `@gmacko/ooda/ext`

**Note:** at this stage there's no `apps/ooda/` yet (created in 7B-1b). Imports of `@gmacko/wiki` and `@gmacko/ext-ooda` likely live in `apps/web/src/app/wiki/` and `apps/web/src/app/{capture,explore,graph}/`. The codemod hits those.

**Steps follow Task 2 pattern.**

**Commit message:** `refactor(workspace): batch 7 — move @gmacko/{wiki,ext-ooda} into @gmacko/ooda subpaths`

---

### Task 9: Verification + tag

**Files affected:** none (verification only).

**Steps:**

1. `pnpm install` clean.
2. `pnpm test` — all tests across all packages green. Expected counts (post-7A): auth 70, agent 33 (parallel-flake permitted on first run; isolated re-run must pass), contracts 12, client 10, secrets 25, projects 8, smoke 9.
3. `pnpm typecheck` — clean (or no new errors beyond OODA pre-existing).
4. Verify the package count:
   ```bash
   ls packages/
   # Expected: bob/  core/  ooda/
   ```
   Three dirs. No more individual `@gmacko/*` package dirs.
5. Verify exports map:
   ```bash
   cat packages/core/package.json | jq '.exports | keys'
   # Expected: ~30 subpath entries: ./auth, ./db, ./agent, etc.
   ```
6. Tag:
   ```bash
   git tag phase-7b-0-consolidation-complete
   ```

**Commit:** none — Task 9 is verification.

---

# Phase 7B-1a: Bob copy (mechanical)

**Source:** `/Volumes/dev/bob/` (Bob's working repo).
**Target:** `apps/bob/`, `apps/mobile-bob/`, `apps/bob-server/`, `apps/bob-execution/`, `packages/bob/src/<area>/` per Bob's package layout.
**Constraint:** zero refactor. Bob runs unchanged on its tRPC + better-auth + Pusher stack inside the gmacko monorepo.

Bob's apps map:
| Bob source | gmacko target |
|---|---|
| `apps/blder/` | `apps/bob/` (Vite + CF Workers, kept as-is; Next.js rewrite is a later sub-phase) |
| `apps/mobile/` | `apps/mobile-bob/` |
| `apps/desktop/` | `apps/desktop-bob/` (deferred — leave as `apps/desktop-bob/` if desktop work happens, otherwise skip) |
| `apps/bob-server/` | `apps/bob-server/` |
| `apps/ws-gateway/` | TBD: either keep as `apps/bob-ws-gateway/` OR drop in favor of `@gmacko/core/ws-gateway` (already in-tree). Recommendation: copy as `apps/bob-ws-gateway/` for now; consolidation into the core ws-gateway is 7B-5's job. |
| `apps/execution/` | `apps/bob-execution/` |
| `apps/web/` (Bob's deprecated) | DELETE — Bob's `apps/web` has no `package.json`, it's dead code per the Bob inventory. |

Bob's packages map:
- All 27 `@bob/*` packages → `packages/bob/src/<area>/` subpaths.
- `packages/bob/package.json` exports map gets ~27 entries.

### Task 10: Pre-copy probe — confirm Bob's tree state

**Files affected:** none (read-only).

**Steps:**

1. `cd /Volumes/dev/bob && git status` — capture clean state. Don't proceed if dirty.
2. `git log -3` — note the SHA of Bob's HEAD; record in the plan retro.
3. `pnpm test` from `/Volumes/dev/bob` — confirm Bob's tests pass at HEAD before copy. If not, STOP and surface failures (we don't want to copy a broken tree).
4. Document Bob's `pnpm-workspace.yaml` content for comparison with gmacko's (gmacko already has `apps/*`, `packages/*`, `tooling/*`).

**Commit:** none.

### Task 11: Copy Bob's apps

**Files affected:**
- Create: `apps/bob/` (from `/Volumes/dev/bob/apps/blder/`)
- Create: `apps/mobile-bob/` (from `/Volumes/dev/bob/apps/mobile/`)
- Create: `apps/bob-server/` (from `/Volumes/dev/bob/apps/bob-server/`)
- Create: `apps/bob-ws-gateway/` (from `/Volumes/dev/bob/apps/ws-gateway/`)
- Create: `apps/bob-execution/` (from `/Volumes/dev/bob/apps/execution/`)

**Steps:**

1. For each app, copy the source tree (NOT `node_modules/` or `dist/`):
   ```bash
   rsync -a --exclude=node_modules --exclude=dist --exclude=.next --exclude=.turbo \
     /Volumes/dev/bob/apps/blder/ apps/bob/
   ```
   Repeat for mobile, bob-server, ws-gateway, execution.

2. For each new app, update `package.json`:
   - `name` field stays as Bob's existing name (e.g. `@bob/blder`, `@bob/mobile`) — we're not renaming Bob packages in 7B-1a.
   - But the **directory** is `apps/bob/` etc. The package's `name` and the directory don't have to match (pnpm handles workspace lookup by `package.json` name regardless of dir).

3. Update root `pnpm-workspace.yaml` if needed — should already match (`apps/*` covers the new dirs).

4. Update root `package.json` `pnpm.overrides` or `pnpm.peerDependencyRules` if Bob has any (compare `/Volumes/dev/bob/package.json` to gmacko's root).

5. Clean up app-level conflicts:
   - If Bob's `apps/blder/tsconfig.json` references `@bob/tsconfig` (Bob's tooling), make sure that tooling lands as part of Task 12 (packages copy). Otherwise the app won't typecheck.

**Commit (single):**

```
git add apps/bob/ apps/mobile-bob/ apps/bob-server/ apps/bob-ws-gateway/ apps/bob-execution/
git commit -m "feat(apps): copy Bob's apps {blder→bob, mobile→mobile-bob, bob-server, ws-gateway→bob-ws-gateway, execution→bob-execution} from /Volumes/dev/bob/"
```

### Task 12: Copy Bob's packages

**Files affected:**
- Create: `packages/bob/src/<area>/` for each of Bob's 27 `@bob/*` packages.
- Update: `packages/bob/package.json` exports map.

**Strategy:** Bob's packages stay under their existing `@bob/*` names for now (keep Bob running). The `packages/bob/` dir holds them as subpaths under `@gmacko/bob`, but for the COPY we initially preserve `@bob/*` package.json names so Bob's existing imports still resolve.

Two viable approaches:

- **(a) Preserve `@bob/*` namespace temporarily.** `packages/bob/src/auth/package.json` keeps `name: "@bob/auth"`. Bob's existing imports (`from "@bob/auth"`) keep working. The `@gmacko/bob` namespace is created but only as a wrapper that gets populated incrementally during 7B-2..N.
- **(b) Rename to `@gmacko/bob/<area>` immediately.** Every `@bob/*` import in Bob's source gets rewritten to `@gmacko/bob/<area>`. Big codemod across Bob's source.

**Recommendation: (a) Preserve `@bob/*`.** Mechanical copy = no semantic changes. The rename to `@gmacko/bob/*` happens incrementally in later sub-phases as each piece is migrated. For 7B-1a, the goal is "Bob's source is visible inside gmacko, untouched."

**Steps:**

1. For each Bob package in `/Volumes/dev/bob/packages/<pkg>/`:
   ```bash
   rsync -a --exclude=node_modules --exclude=dist --exclude=.turbo \
     /Volumes/dev/bob/packages/<pkg>/ packages/bob/src/<pkg>/
   ```

2. The packages keep their own `package.json` (with `name: "@bob/<pkg>"`), `tsconfig.json`, `vitest.config.ts`. They become **nested workspace packages** inside `packages/bob/`.

3. Update root `pnpm-workspace.yaml` to recognize the nested packages:
   ```yaml
   packages:
     - "apps/*"
     - "packages/*"
     - "packages/bob/src/*"  # NEW
     - "tooling/*"
   ```

4. Copy Bob's tooling packages as well:
   ```bash
   rsync -a --exclude=node_modules /Volumes/dev/bob/tooling/typescript/ tooling/bob-typescript/
   rsync -a --exclude=node_modules /Volumes/dev/bob/tooling/eslint/ tooling/bob-eslint/
   rsync -a --exclude=node_modules /Volumes/dev/bob/tooling/prettier/ tooling/bob-prettier/
   rsync -a --exclude=node_modules /Volumes/dev/bob/tooling/tailwind/ tooling/bob-tailwind/  # if exists
   ```
   Bob's tools land under their own names (`@bob/tsconfig`, `@bob/eslint-config`, etc.) so they don't collide with gmacko's `@gmacko/tsconfig`.

5. Run `pnpm install` from workspace root. Resolves all the new packages.

**Commit:**

```
git add packages/bob/ tooling/bob-* pnpm-workspace.yaml
git commit -m "feat(packages): copy Bob's 27 @bob/* packages into packages/bob/src/* (preserved as nested workspace packages)"
```

### Task 13: Verify Bob still works post-copy

**Steps:**

1. `pnpm install` clean.
2. `cd apps/bob && pnpm test 2>&1 | tail -20`. Expected: Bob's tests pass with the same counts as on `/Volumes/dev/bob`'s HEAD.
3. `cd apps/mobile-bob && pnpm test 2>&1 | tail -10` if it has tests.
4. `cd apps/bob-server && pnpm test 2>&1 | tail -10` if it has tests.
5. **Build sanity:** `cd apps/bob && pnpm build 2>&1 | tail -20` (Vite build). Should succeed.
6. **Boot sanity:** `cd apps/bob && pnpm dev` for ~10s, confirm it serves a page (curl localhost:port). Kill.
7. `pnpm test` from gmacko root — confirm gmacko's tests still pass (auth 70, etc.). Bob's addition shouldn't break anything in gmacko.

**Commit:** none (verification).

**Tag:** `git tag phase-7b-1a-bob-copied`

### Task 14: Update root CLAUDE.md to reflect Bob's new location

**Files:**
- Modify: `CLAUDE.md`

**Steps:**

1. Add a section noting Bob now lives at `apps/bob/` + `packages/bob/src/*`.
2. Note Bob is on Vite + CF Workers (not Next.js); `apps/core/` and `apps/ooda/` are Next.js.
3. Note Bob preserves `@bob/*` namespace temporarily; migration to `@gmacko/bob/*` happens incrementally in 7B-2..N.

**Commit:** `docs: update CLAUDE.md to reflect Bob copy at apps/bob/ and packages/bob/`

---

# Phase 7B-1b: OODA promote + apps/web rename

After 7B-1a, the monorepo has gmacko (in 3 packages + 4 apps) + Bob (in nested `packages/bob/` + 5+ apps). Now: split `apps/web` into `apps/core` (gmacko reference) + `apps/ooda` (OODA-specific routes).

OODA route map (per inventory):
| `apps/web/` source | Destination |
|---|---|
| `src/app/capture/` | `apps/ooda/src/app/capture/` |
| `src/app/explore/` | `apps/ooda/src/app/explore/` |
| `src/app/graph/` | `apps/ooda/src/app/graph/` |
| `src/app/wiki/` | `apps/ooda/src/app/wiki/` |
| `src/app/page.tsx` (current chat UI) | `apps/ooda/src/app/page.tsx` (it's OODA's chat UI; OODA owns it) |
| `src/components/voice-input.tsx` | `apps/ooda/src/components/voice-input.tsx` |
| `src/rpc/client.ts` | `apps/ooda/src/rpc/client.ts` |
| `src/rpc/hooks.ts` | `apps/ooda/src/rpc/hooks.ts` |
| `src/rpc/provider.tsx` | `apps/ooda/src/rpc/provider.tsx` |
| `src/app/agent/` | stays — `apps/core/src/app/agent/` |
| `src/app/dashboard/` | stays |
| `src/app/projects/` | stays |
| `src/app/secrets/` | stays |
| `src/app/login/` | stays |
| `src/app/api/rpc/` | stays |
| `src/app/api/auth/[...all]/` | stays |
| `src/server/` | stays |
| `src/__tests__/smoke.test.ts` | stays |
| `next.config.ts`, `tsconfig.json`, `vitest.config.ts`, `DEPLOY.md` | stays in apps/core; duplicate (with edits) for apps/ooda |
| `package.json` | split |

### Task 15: Create `apps/ooda/` skeleton

**Files:**
- Create: `apps/ooda/package.json`
- Create: `apps/ooda/tsconfig.json`
- Create: `apps/ooda/vitest.config.ts` (minimal)
- Create: `apps/ooda/next.config.ts` (copy of `apps/web/next.config.ts` with edits)
- Create: `apps/ooda/src/app/layout.tsx` (placeholder — OODA's actual layout comes via the route move in Task 17)

**Step 1: Write `apps/ooda/package.json`** — derived from `apps/web/package.json` keeping only deps that OODA needs per the inventory:

```json
{
  "name": "@gmacko/ooda-web",
  "private": true,
  "version": "0.0.0",
  "type": "module",
  "scripts": {
    "dev": "next dev --turbopack -p 3001",
    "build": "next build",
    "start": "next start -p 3001",
    "test": "vitest run --passWithNoTests"
  },
  "dependencies": {
    "@gmacko/core": "workspace:*",
    "@gmacko/ooda": "workspace:*",
    "@tanstack/react-query": "^5.66.0",
    "next": "16.0.0",
    "react": "19.0.0",
    "react-dom": "19.0.0",
    "@xyflow/react": "^12.0.0"
  },
  "devDependencies": {
    "@gmacko/tsconfig": "workspace:*",
    "@types/node": "25.6.0",
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "typescript": "^5.9.0",
    "vitest": "^3.0.0"
  }
}
```

(Adjust dep versions to match what `apps/web/package.json` actually has — copy from there to avoid drift.)

**Step 2: Write `apps/ooda/next.config.ts`** — start as a copy of `apps/web/next.config.ts` with `transpilePackages: ["@gmacko/core", "@gmacko/ooda"]` (just the two packages OODA consumes).

**Step 3: `pnpm install`.** Recognizes the new `@gmacko/ooda-web` workspace.

**Commit:**
```
git add apps/ooda/
git commit -m "feat(apps): create apps/ooda skeleton (Next.js, port 3001)"
```

### Task 16: Move OODA routes + components + RPC client

**Files affected:** all OODA routes/components per the table above.

**Steps:**

1. `git mv apps/web/src/app/capture apps/ooda/src/app/capture`
2. `git mv apps/web/src/app/explore apps/ooda/src/app/explore`
3. `git mv apps/web/src/app/graph apps/ooda/src/app/graph`
4. `git mv apps/web/src/app/wiki apps/ooda/src/app/wiki`
5. `git mv apps/web/src/app/page.tsx apps/ooda/src/app/page.tsx`
6. `git mv apps/web/src/components/voice-input.tsx apps/ooda/src/components/voice-input.tsx`
7. `git mv apps/web/src/rpc apps/ooda/src/rpc`

**Step 8 — Replace `apps/web/src/app/page.tsx`** (now empty after Task 16 step 5) with a minimal agent harness landing page:

```tsx
// apps/web/src/app/page.tsx — gmacko reference impl landing page.
// Agent-harness UI lives at /agent. This page is intentionally minimal.
export default function HomePage() {
  return (
    <main className="p-8">
      <h1 className="text-2xl font-bold">gmacko reference impl</h1>
      <p className="mt-2">
        See <a href="/agent" className="underline">/agent</a> for the CLI agent harness,
        {" "}<a href="/dashboard" className="underline">/dashboard</a> for navigation.
      </p>
    </main>
  );
}
```

**Step 9 — Update OODA routes' import paths.** Anything that was `@/rpc/client` → `@/rpc/client` still works (paths are relative to the package root, which is now `apps/ooda/` for these files). Any `@/components/voice-input` imports need verification. Same for RPC hooks.

**Step 10 — `apps/ooda/src/app/layout.tsx`:** copy from `apps/web/src/app/layout.tsx`. Both apps have similar layouts; can diverge later.

**Step 11 — Verify OODA routes typecheck:**

```bash
cd apps/ooda && npx tsc --noEmit
```

Expected: pre-existing OODA errors (graph/page.tsx readonly tags, voice-input undefined) still appear here — they moved with the code. They were a baseline noise pre-7B; remain so post-7B.

**Step 12 — Verify apps/web (now stripped):**

```bash
cd apps/web && pnpm test -- smoke
```

Expected: 9/9 still passing — the smoke test never touched OODA-specific routes anyway.

**Commit:**

```
git add -A
git commit -m "refactor(apps): promote OODA routes from apps/web to apps/ooda; replace apps/web/page.tsx with reference landing"
```

### Task 17: Rename `apps/web/` → `apps/core/` and `apps/mobile/` → `apps/mobile-core/`

**Files affected:** every file in `apps/web/` and `apps/mobile/`.

**Steps:**

1. `git mv apps/web apps/core`
2. `git mv apps/mobile apps/mobile-core`
3. Update `apps/core/package.json` `name` to `@gmacko/core-web` (or similar — pick a name that reflects "gmacko reference web app"). Update `apps/mobile-core/package.json` similarly.
4. Update `apps/core/next.config.ts` — should be unchanged after the rename (relative paths still valid).
5. Update `apps/core/src/__tests__/smoke.test.ts` — confirm `APP_DIR = resolve(process.cwd())` still resolves correctly (it does — vitest runs from the package root regardless of dir name).
6. Update root `package.json` scripts if any reference `apps/web` or `apps/mobile`.
7. Update root `CLAUDE.md` to reflect the renames.
8. Update `apps/core/DEPLOY.md` if it self-references "apps/web".
9. `pnpm install` clean.
10. `cd apps/core && pnpm test -- smoke` — 9/9.

**Commit:**

```
git add -A
git commit -m "refactor(apps): rename apps/web → apps/core (gmacko reference); apps/mobile → apps/mobile-core"
```

### Task 18: Verify final state + tag

**Steps:**

1. `ls apps/`:
   ```
   bob/  bob-execution/  bob-server/  bob-ws-gateway/
   core/  desktop/  mobile-bob/  mobile-core/  ooda/
   ```
   (Plus optionally a renamed `desktop` → `desktop-core`; defer to a later sub-phase if not needed yet.)

2. `ls packages/`:
   ```
   bob/  core/  ooda/
   ```

3. `pnpm test` from root — all green:
   - `@gmacko/core` 165+ tests (consolidated count of all sub-pkg tests)
   - `apps/core` smoke 9/9
   - `apps/bob` Bob's existing tests
   - `apps/ooda` minimal (no OODA-specific tests yet)

4. `pnpm typecheck` — no new errors beyond pre-existing OODA baseline.

5. Tag: `git tag phase-7b-foundation-complete`

**Commit:** none.

---

## Open questions / risks

- **Bob's packages will keep their `@bob/*` names temporarily.** That means `packages/bob/src/auth/package.json` has `name: "@bob/auth"` while `packages/core/src/auth/` has no `package.json` (it's a subpath of `@gmacko/core`). This asymmetry is intentional — gmacko consolidates aggressively; Bob preserves its existing surface until later sub-phases migrate piece-by-piece. Worth a note in the retro.

- **Bob's tooling collides with gmacko's `@gmacko/tsconfig`.** Bob's `@bob/tsconfig` lands as a separate workspace package at `tooling/bob-typescript/`. Both can coexist; Bob's apps reference `@bob/tsconfig`, gmacko's reference `@gmacko/tsconfig`.

- **Vite + Cloudflare Workers vs Next.js 16.** `apps/bob` is Vite (with `wrangler.jsonc` for CF deploy). The gmacko monorepo so far has been Next.js-only at the app level. Multi-stack monorepo isn't ideal but acceptable — both stacks can coexist via pnpm + turbo. Bob's Next.js rewrite is a deferred sub-phase (7B-?) before UI migration (7B-8).

- **Bob's `@effect/platform` transitive dep** may pull in `effect` at a different version than gmacko's `4.0.0-beta.43`. Worth checking with `pnpm why effect` after the copy. If versions diverge, pin via `pnpm.overrides` in root `package.json`.

- **Test runner version skew.** Bob uses `vitest@^4.0.0` (loose); gmacko uses `vitest@^3.0.0`. The looser range may resolve to a different version. Consider pinning to a single vitest version across the workspace via `pnpm.overrides`.

- **Drizzle migration history collision.** Both gmacko and Bob run `drizzle-kit` against their own DBs today. Post-copy, each app keeps its own migration history (`apps/bob/drizzle/` and `apps/core/drizzle/`). Schema merge happens in 7B-2.

- **Path 7B-2 onward needs a separate plan doc.** This document covers ONLY 7B-0 + 7B-1. Each of 7B-2 through 7B-9 will get its own plan when we reach it.

---

## Success criteria for Phase 7B-foundation (this session)

1. ✅ `packages/` has exactly three dirs: `bob/`, `core/`, `ooda/`.
2. ✅ `apps/` has at minimum: `bob/`, `bob-execution/`, `bob-server/`, `bob-ws-gateway/`, `core/`, `mobile-bob/`, `mobile-core/`, `ooda/`. (`apps/desktop/` retained or renamed; `apps/server/` deleted.)
3. ✅ `apps/core` smoke test 9/9 passing.
4. ✅ `apps/bob` builds + dev-boots successfully on its existing Vite stack.
5. ✅ All consolidated gmacko tests green (auth 70, agent 33-isolated, contracts 12, etc.).
6. ✅ `pnpm install` clean from root.
7. ✅ Three tags landed on master: `phase-7b-0-consolidation-complete`, `phase-7b-1a-bob-copied`, `phase-7b-foundation-complete`.
