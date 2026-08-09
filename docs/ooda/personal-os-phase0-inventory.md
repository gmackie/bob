# OODA Personal OS: Phase 0 source and safety inventory

Snapshot: 2026-08-05T15:39:51-04:00

This document is an execution record, not a plan. The approved implementation plan is
`docs/plans/2026-08-05-ooda-personal-operating-system.html` and is published at
<https://hktwmax9udns.postplan.dev>.

## Canonical source and branch

- Canonical repository: Bob monorepo.
- Canonical base: `371b09aee71fced72aecee6189cd1fff6a3a24a5`.
- Resolution: `forge/master`, `origin/master`, and `forgejo/master` all resolved to that exact commit after a live fetch/lookup.
- Isolated branch: `feat/ooda-personal-os`.
- Isolated worktree: `~/.config/superpowers/worktrees/bob/feat/ooda-personal-os`.
- The dirty primary checkout was not modified. It remains on `feat/ooda-dispatch-endpoint` with its pre-existing working-copy changes.
- The old `forgejo` remote contained an embedded HTTPS credential. The credential no longer authenticated, so there was no live token to rotate. The URL has been replaced in the shared Git config with credential-free SSH and a live `ls-remote` succeeds.

## Current production topology

| Surface | Verified state | Disposition |
|---|---|---|
| OODA edge | `https://ooda.blder.bot/`, `/health`, and `/oracle` returned HTTP 200 | Remains the web/edge client and edge API runtime |
| OODA edge deployment | Cloudflare Worker `ooda-blder-bot`, active version `afefb54b-2f2f-4fc1-9fc0-459c108822b2`, deployed 2026-08-04T21:26:18Z | Preserve; the upload has no commit tag. Timing makes `371b09ae` the likely source commit, but that mapping is an inference, not immutable deployment metadata |
| Production database | PostgreSQL 17.9 on the production host; pgvector 0.8.2 | Canonical OODA store will live here in an OODA-owned schema/table namespace |
| Bob realtime gateway | `bob-ws-gateway.service` active | Remains Bob execution transport; OODA links to it through Bob contracts |
| OODA runner | `ooda-runner.service` active on the runner host | Refactor into explicit OODA-job and Bob-durable-run intents |
| Runner checkout | Commit `28919397`, six dirty entries; service has been active since 2026-08-05T06:08:51Z | Deployment drift. Do not overwrite; inventory and reconcile before a runner deploy |
| Runner providers | Codex CLI 0.135.0, Claude Code 2.1.220, Grok 0.2.118 present | Provider CLIs are available; auth is provider-native rather than API-key environment variables |
| Local providers | Codex CLI 0.146.0, Claude Code 2.1.222, Grok 0.2.118 present | Suitable for development and contract fixtures |
| ElevenLabs | No key in the standalone OODA environment or runner environment | TTS remains disabled until a server-side secret is provisioned; never provision it to mobile |

The checked-in deployment path is Cloudflare Workers for web/edge and Hyperdrive to the shared Bob database. Node-only runner, vault, Git, and sandbox operations stay on trusted hosts.

## Live production row counts

These are exact `COUNT(*)` results from the shared Bob production database at the snapshot time.

| Source table | Rows | Meaning |
|---|---:|---|
| `research_thread` | 38 | Existing OODA research threads; migrate to human-facing conversations |
| `runner_device` | 4 | Existing runner registrations; retain as operational compatibility input |
| `runner_session` | 63 | Existing OODA provider sessions; migrate/link as jobs and provider-linked events |
| `session_event` | 356 | Existing OODA session transcript/progress events; backfill into canonical conversation/job events |
| `provenance_event` | 0 | No row migration required; preserve schema semantics in lineage contracts |
| `note_index` | 0 | No rows to backfill |
| `note_entity` | 0 | No rows to backfill |
| `graph_exploration` | 0 | No rows to backfill |
| `thread_memory` | 0 | No byte-packed thread vectors to backfill in production |
| `thread_link` | 0 | No rows to backfill |
| `tool_call_log` | 0 | No rows to backfill |
| `chat_conversations` | 2,592 | Bob execution/planning records; do not reclassify as personal deliberation |
| `chat_messages` | 0 | Bob transcript state is primarily event-based in this deployment |
| `chat_attachments` | 0 | No rows to migrate |
| `planning_session_messages` | 0 | No rows to migrate |
| `session_events` | 311,650 | Bob execution evidence; retain in Bob and expose through OODA external links/receipts |
| `research_vault.sources` | 100 | Retain; memory search may link to it but does not copy its canonical source facts |
| `research_vault.embeddings` | 0 | No production bytea-vector backfill required for these rows yet |
| `personal_vault.sources` | 0 | No rows to backfill |
| `personal_vault.embeddings` | 0 | No rows to backfill |

`chat_conversations` consists of 2,534 execution, 56 planning, and 2 task sessions. The legacy OODA runner sessions consist of 13 completed, 17 failed, and 33 marked running. Running status must be reconciled against the runner before backfill; it must not be treated as proof that all 33 jobs are currently alive.

The core skeleton tables `thread`, `branch`, and `message` do not exist in production, so the conditional Phase 1 rule resolves to **no migration** for that source.

## Standalone database

The environment attached to the standalone repository is not the live edge database. Its exact relevant counts are:

- 1 `research_thread`, 1 auth `user`, and 1 auth `session`.
- 0 runner sessions and 0 session events.
- 62,293 `research_vault.sources`, 62,293 bytea `research_vault.embeddings`, 2,558 source/topic links, and 164 topics.
- 0 `personal_vault` rows.
- No pgvector extension.

The standalone vault corpus is migration input, not evidence that the obsolete database should remain a runtime owner. Its 62,293 bytea embeddings require an incremental pgvector backfill rather than copying the old encoding into new tables.

## Restorable backups

Both archives are local, permission-restricted (`0600`), excluded from Git, and accompanied by SHA-256 files.

| Source | Archive | Bytes | SHA-256 | Restore rehearsal |
|---|---|---:|---|---|
| Standalone OODA DB | `~/Library/Application Support/OODA/backups/phase0-20260805/ooda-pre-migration.dump` | 287,381,718 | `1eb94f8dcf0a32e83d225aaa2a9697d9ab910b394e5fa868ab732c6a24539336` | Restored into an isolated temporary PostgreSQL 16 cluster; archive list and source counts verified |
| Shared Bob production DB | `~/Library/Application Support/OODA/backups/phase0-20260805/bob-pre-migration.dump` | 160,397,029 | `6728d1ad55247c51e4e2b9a43cdb7a3e943d739ed6e42356f1b37606620b7a7f` | Restored into an isolated pgvector/PostgreSQL 17 container; 38 research threads, 2,592 chat conversations, and 311,650 Bob session events matched exactly |

The Bob restore target supplied pgvector 0.8.6 while production currently uses 0.8.2. The archive restored successfully, but Phase 1 migration CI must pin or explicitly test both extension versions instead of assuming the local image is an exact extension replica.

## Schema migration dispositions

| Existing owner | Current schema | Phase 1 disposition |
|---|---|---|
| OODA research | `packages/ooda/src/db/schema/research.ts` | `research_thread` → conversation + initial branch; `runner_session` → provider-linked job/session metadata; `session_event` → versioned conversation/job events; retain original IDs in migration metadata |
| OODA research buddy | `packages/ooda/src/db/schema/research-buddy.ts` | Preserve note/entity/provenance lineage; replace new bytea vectors with pgvector. Existing production tables are empty, while standalone vault embeddings backfill incrementally |
| Core skeleton | `packages/core/src/db/schema/{threads,branches,messages}.ts` | Compatibility definitions only. Production tables are absent, therefore no backfill |
| Core agent sessions | `packages/core/src/db/schema/sessions.ts` | Superseded by the active Bob bounded-context implementation; do not use as the OODA conversation source of truth |
| Bob execution | `packages/bob/src/chat/src/schema.ts` plus Bob `session_events` | Remain Bob execution records. Add OODA `external_links` and evidence receipts; never reclassify as personal conversation history |
| Standalone OODA | Standalone apps/packages and DB | Migration input only. Export/archive after mobile, web, data, imports, runner, and CLI behavior reach verified parity |

## Standalone repository feature inventory

The standalone repository has 675 tracked files. Only 232 distinct blob hashes are exact matches in the Bob monorepo, but much of the apparent difference is package-boundary/import churn. The migration must audit behavior rather than using raw file equality as a parity test.

| Standalone capability | Bob state | Required disposition |
|---|---|---|
| Next.js research UI | Substantially represented by `apps/ooda`; duplicated again in `apps/ooda-edge` | Preserve behavior through shared contracts/view models, then remove duplicate server logic |
| Runner and provider adapters | Represented in `apps/ooda-runner` and `packages/ooda/src/agent-adapters` | Extend existing adapters and runner; do not introduce another executor |
| Research backend, imports, paper search, entity extraction, and synergy | Research backend is largely present in the monorepo; 100 production research sources remain live | Keep as migration input for memory/import phases; add pgvector and policy boundaries |
| Standalone mobile research tabs | Superseded by `apps/mobile-bob` daily-driver work | Audit useful research/health affordances, but do not keep a second mobile app |
| CLI thread/export/migrate commands | No canonical personal-OS CLI contract yet | Retain migration/export utilities; normal daily use moves to mobile/web APIs |
| `ooda promote` direct Pulse draft creation (standalone commit `27e0af1`) | Not present in Bob | Re-express as an OODA opportunity review + approved BizPulse proposal/outbox delivery. Do not port the direct unledgered POST |
| Git-backed thread workspaces and provenance | Present under `packages/ooda` | Preserve for promoted artifacts and migration exports, not as a substitute for canonical event history |
| Dirty standalone changes | `.forgegraph.yaml` modified; one legacy markdown plan added | User-owned migration input. Do not overwrite or retire until explicitly archived after parity |

## Baseline verification

- Dependency installation succeeded from the locked workspace graph.
- The repository requires Node 24+, while the local shell currently runs Node 22.22.0. The runner host has Node 24.16.0.
- `pnpm --filter @gmacko/ooda typecheck` passes.
- OODA tests: 517 pass, 6 skip, 3 fail on canonical master.
- All three failures are the same pre-existing OpenAPI generation defect: `mutation.bob.dispatch` uses an output parser that `trpc-to-openapi` does not recognize as a Zod validator.
- The OpenAPI defect is inside the approved contract/API scope and must be fixed before a green Phase 1 baseline is claimed.

## Phase 0 exit assessment

- Canonical base and deployment path: documented.
- Every discovered conversation/session source: disposition recorded.
- User working copies: preserved.
- Embedded Git credential: removed; invalid credential confirmed; SSH remote verified.
- Database backups: created and restored successfully.
- Remaining prerequisite for Phase 1: repair the pre-existing OpenAPI output schema failure and add automated migration/contract tests before schema generation.
