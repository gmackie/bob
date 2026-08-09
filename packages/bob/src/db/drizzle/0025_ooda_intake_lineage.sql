ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "external_provider" varchar(32);
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "external_id" text;
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "source_metadata" jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE "work_items" ADD COLUMN IF NOT EXISTS "source_metadata" jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE UNIQUE INDEX IF NOT EXISTS "projects_external_provider_id_uidx"
  ON "projects" ("external_provider", "external_id")
  WHERE "external_provider" IS NOT NULL AND "external_id" IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "work_items_external_provider_id_uidx"
  ON "work_items" ("external_provider", "external_id")
  WHERE "external_provider" IS NOT NULL AND "external_id" IS NOT NULL;
