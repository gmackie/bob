DROP INDEX IF EXISTS "ooda"."migration_records_destination_idx";
DROP INDEX IF EXISTS "ooda"."migration_records_source_entity_uidx";
DROP INDEX IF EXISTS "ooda"."migration_runs_status_updated_idx";
DROP INDEX IF EXISTS "ooda"."migration_runs_source_fingerprint_uidx";
DROP TABLE IF EXISTS "ooda"."migration_records";
DROP TABLE IF EXISTS "ooda"."migration_runs";
DROP TYPE IF EXISTS "ooda"."migration_run_status";

DROP INDEX IF EXISTS "personal_vault"."source_embedding_vec_hnsw_idx";
DROP INDEX IF EXISTS "research_vault"."source_embedding_vec_hnsw_idx";
DROP TABLE IF EXISTS "personal_vault"."source_embedding";
DROP TABLE IF EXISTS "research_vault"."source_embedding";
