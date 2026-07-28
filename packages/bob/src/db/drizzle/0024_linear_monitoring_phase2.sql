-- Phase 2 Linear monitoring.
--
-- work_items.external_url: the canonical link back to the source issue (e.g. a
--   Linear issue URL) so the work-item detail view can deep-link out. NULL for
--   locally-created items and rows imported before this column existed (a
--   re-sync backfills them).
ALTER TABLE "work_items" ADD COLUMN IF NOT EXISTS "external_url" text;

-- workspace_integrations sync-health: surface when a provider last synced and
--   the one-line outcome, instead of the counts living only in cron console
--   logs. NULL until the first sync after this migration.
ALTER TABLE "workspace_integrations" ADD COLUMN IF NOT EXISTS "last_synced_at" timestamptz;
ALTER TABLE "workspace_integrations" ADD COLUMN IF NOT EXISTS "last_sync_result" text;
