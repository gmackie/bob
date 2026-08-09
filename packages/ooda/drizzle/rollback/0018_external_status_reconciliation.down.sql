DROP INDEX IF EXISTS "ooda"."external_links_status_check_idx";
ALTER TABLE "ooda"."external_links" DROP COLUMN IF EXISTS "next_status_check_at";
ALTER TABLE "ooda"."external_links" DROP COLUMN IF EXISTS "status_error";
ALTER TABLE "ooda"."external_links" DROP COLUMN IF EXISTS "status_claimed_by";
ALTER TABLE "ooda"."external_links" DROP COLUMN IF EXISTS "status_claimed_at";
ALTER TABLE "ooda"."external_links" DROP COLUMN IF EXISTS "status_observed_at";
