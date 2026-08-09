# Standalone OODA vault migration

Date: 2026-08-09

This is the operator runbook and rehearsal receipt for moving the standalone
OODA research corpus into Bob's canonical database. The approved Personal OS
plan remains <https://hktwmax9udns.postplan.dev>.

## What moves

The standalone database is migration input, not a runtime owner. Its verified
snapshot contains:

| Entity | Count |
|---|---:|
| Sources | 62,293 |
| Imported chats | 2,367 |
| YouTube sources | 59,926 |
| Topics | 164 |
| Source/topic links | 2,558 |
| Legacy `nomic-embed-text` bytea embeddings | 62,293 |

Source bodies, provenance fields, topic assignments, and timestamps are copied.
Legacy byte-packed vectors are deliberately not copied. They are regenerated
into the additive `source_embedding vector(768)` projection.

## Safety model

- `inventory` opens the source connection read-only and does not need a target.
- `copy` and `embed` refuse to write unless
  `OODA_STANDALONE_IMPORT_CONFIRM` exactly matches the inventory fingerprint.
- Canonical conflicts with the same `(kind, external_id)` but different content
  hashes stop the import; standalone data never silently overwrites newer data.
- Every imported source and topic has an `ooda.migration_records` mapping.
- Source batches update their cursor in the same transaction as rows and ledger
  records. A missing cursor is reconstructed from the ledger.
- Verification compares entity counts and an ordered source/content hash.
- The old `research_vault.embeddings` table stays readable for rollback and
  forensic comparison. New search never writes it.
- No provider credential or database URL is printed in receipts.

## Commands

Use Node 24 or newer from the repository root. Supply the source restore URL,
the canonical target URL, and the real owner ID through the environment.

```sh
pnpm --filter @gmacko/ooda db:migrate:standalone-vault inventory
```

Copy the printed fingerprint into `OODA_STANDALONE_IMPORT_CONFIRM`, then run:

```sh
pnpm --filter @gmacko/ooda db:migrate:standalone-vault copy
pnpm --filter @gmacko/ooda db:migrate:standalone-vault verify
```

After a trusted-host Ollama service has the configured 768-dimension model:

```sh
pnpm --filter @gmacko/ooda db:migrate:standalone-vault embed
pnpm --filter @gmacko/ooda db:migrate:standalone-vault verify
```

`OODA_STANDALONE_IMPORT_MAX_SOURCES` and
`OODA_STANDALONE_EMBED_MAX_SOURCES` bound rehearsals. Omit them for the complete
run. The embedding command never pulls a model and never falls back to a paid
cloud API.

## Rehearsal receipt

The Phase 0 standalone dump with SHA-256
`1eb94f8dcf0a32e83d225aaa2a9697d9ab910b394e5fa868ab732c6a24539336`
was restored into PostgreSQL 16. A separate pgvector/PostgreSQL 17 target was
migrated through `0019_standalone_vault_pgvector.sql`.

The complete copy and an immediate idempotent rerun both produced:

| Check | Source | Destination | Result |
|---|---:|---:|---|
| Sources | 62,293 | 62,293 | pass |
| Topics | 164 | 164 | pass |
| Source/topic links | 2,558 | 2,558 | pass |
| Ordered source hash | `903b695616539a899340f8f4338d2d27` | `903b695616539a899340f8f4338d2d27` | pass |

A controlled Ollama-compatible endpoint returned two finite 768-dimension
vectors. Both were inserted into pgvector, and PostgreSQL demonstrated that
`source_embedding_vec_hnsw_idx` is usable for cosine ordering. This proves the
write and query path without implying that the full production backfill has
run.

The scoped rollback removed both vector projections, both migration-ledger
tables, their indexes, and their enum while preserving all 62,293 copied
sources, 164 topics, and 2,558 topic links. All temporary containers and the
controlled embedding endpoint were removed afterward.

Verification at commit `462a0f93832a2a9bc3c631b99cddb5a4d72d04a7`:

- OODA: 98 files passed, 3 skipped; 656 tests passed, 29 skipped.
- Research backend: 308 tests passed against a freshly migrated
  pgvector/PostgreSQL 17 database.
- Changed Python files: Ruff clean.
- OODA TypeScript: typecheck passed.

## Production promotion gates

The production copy and full embedding backfill have not run. Before promoting:

1. Take a fresh canonical database backup and verify its checksum.
2. Deploy migration `0019` and confirm both source-kind enum additions and both
   HNSW indexes.
3. Provision a trusted-host Ollama instance with a model that returns exactly
   768 finite dimensions. `nomic-embed-text` is the current default.
4. Run inventory against the immutable standalone restore and record the new
   fingerprint.
5. Run copy, verify, embed, and verify. Do not accept completion until
   `copyOk=true` and `embeddingComplete=true`.
6. Search representative imported chats and YouTube sources through the live
   OODA context path.
7. Keep the standalone repository until the separate mobile/web sequence parity
   and 14-day dogfood gates pass.
