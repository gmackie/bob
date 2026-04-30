# Phase 7B-2 — DB Schema Merge Complete

**Date:** 2026-04-28
**Branch:** `phase-7b-2-db-merge`
**Commits:** 16 (Tasks 0–22)

## Result

Bob's monolithic `packages/bob/src/db/src/schema.ts` (2824 lines, 62 tables)
plus `auth-schema.ts` (53 lines, 4 tables) → split into 13 co-located area
packages. The monolith is now a 15-line thin barrel re-exporting from all areas.

**Post table dropped** (t3 boilerplate, never used in production).
**auth-schema.ts deleted** (consolidated into `@bob/auth/schema`).

## Per-area table counts (65 total)

| Area | Package | Tables | Lines |
|---|---|---:|---:|
| auth | `@bob/auth` | 6 | 99 |
| tenancy | `@bob/tenancy` | 4 | 146 |
| settings | `@bob/settings` | 1 | 46 |
| projects | `@bob/projects` | 6 | 347 |
| work-items | `@bob/work-items` | 12 | 1025 |
| agents | `@bob/agents` | 12 | 574 |
| chat | `@bob/chat` | 3 | 198 |
| git | `@bob/git` | 6 | 356 |
| webhooks | `@bob/webhooks` | 2 | 120 |
| ci | `@bob/ci` | 4 | 162 |
| notifications | `@bob/notifications` | 4 | 210 |
| cookies | `@bob/cookies` | 2 | 108 |
| secrets | `@bob/secrets` | 3 | 164 |
| **Total** | | **65** | **3555** |
| barrel | `@bob/db/schema` | 0 | 15 |

## Test verification

| Suite | Result |
|---|---|
| `@bob/api` tests | 370 passed, 1 skipped (baseline match) |
| `@bob/api` file failures | 2 (pre-existing DATABASE_URL gates) |
| `@gmacko/bob` typecheck | green |
| `@gmacko/core` tests | 347/347 |
| `@gmacko/ooda` tests | 8/8 |
| Smoke (apps/core) | 9/9 |

## Import sites

| Import shape | Baseline | After |
|---|---:|---:|
| `from "@bob/db/schema"` | 62 | 56 |
| `from "@bob/db"` (operators) | 52 | 47 |
| `from "@bob/db/client"` | 30 | 25 |
| Direct area imports (new) | 0 | 41 |

Reduction from baseline: post.ts deleted (-1 schema, -1 operator), 2 API files
migrated to direct area imports by subagents, 1 test file updated to import from
area package. All 128 remaining `@bob/db*` imports resolve correctly. 41 new
cross-area imports within schema files themselves.

## Known issues

**Turbo `^build` cycle**: The workspace-level circular dependencies between area
packages (auth ↔ tenancy, agents ↔ chat, agents ↔ projects, etc.) cause turbo to
error on `turbo run test` without a `--filter`. Individual package tests and
`--filter=@gmacko/bob` typecheck work fine. This is structural from cross-area FK
references and needs a turbo.json adjustment (remove `^build` from test/typecheck
tasks for `@bob/*` packages, or use `transit` nodes). Deferred to 7B-3.

**ESM binding cycles**: Managed by:
- Agents tables referencing chatConversations: FK `.references()` restored after
  chat moved to its own package (Task 14).
- `agentTypeEnum`/`instanceStatusEnum` duplicated as literals in agents (used only
  by `z.enum()` in CreateAgentInstanceSchema); canonical exports remain in projects.
- All cycles are declaration-only (pgTable/relations are lazy) — no runtime issues.

## Drizzle config

`packages/bob/src/db/drizzle.config.ts` unchanged — `schema: "./src/schema.ts"`
resolves all 65 tables via the barrel re-exports.

## Commit log

```
67bc899 refactor(bob): drop Post table, finalize @bob/db/schema barrel (Phase 7B-2 Tasks 21-22)
7ac753e refactor(bob): move secrets tables to @bob/secrets/schema (Phase 7B-2 Task 20)
45dc3a6 refactor(bob): move cookies tables to @bob/cookies/schema (Phase 7B-2 Task 19)
59a97b2 refactor(bob): move notifications tables to @bob/notifications/schema (Phase 7B-2 Task 18)
3ed256b refactor(bob): move ci tables to @bob/ci/schema (Phase 7B-2 Task 17)
09daec2 refactor(bob): move webhooks tables to @bob/webhooks/schema (Phase 7B-2 Task 16)
697788e refactor(bob): move git tables to @bob/git/schema (Phase 7B-2 Task 15)
cda4de0 refactor(bob): move chat tables to @bob/chat/schema (Phase 7B-2 Task 14)
51aa780 refactor(bob): move agents tables to @bob/agents/schema (Phase 7B-2 Task 13)
1aed3bd refactor(bob): move work-items tables to @bob/work-items/schema (Phase 7B-2 Task 12)
58460ca refactor(bob): move projects tables to @bob/projects/schema (Phase 7B-2 Task 11)
e5a1d1d refactor(bob): move userPreferences to @bob/settings/schema (Phase 7B-2 Task 10)
01f390c refactor(bob): consolidate auth tables into @bob/auth/schema, retire auth-schema.ts (Phase 7B-2 Task 9)
1b0acb3 refactor(bob): move tenancy tables to @bob/tenancy/schema (Phase 7B-2 Task 8)
752d1be feat(bob): create 7 new @bob/* area pkg shells (Phase 7B-2 Tasks 1-7)
83631aa docs(phase-7b-2): plan + baseline for DB schema merge (Task 0)
```
