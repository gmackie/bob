DROP INDEX IF EXISTS "ooda"."attention_reviews_memory_idempotency_uidx";
ALTER TABLE "ooda"."attention_reviews" DROP COLUMN IF EXISTS "command_fingerprint";
ALTER TABLE "ooda"."attention_reviews" DROP COLUMN IF EXISTS "idempotency_key";
ALTER TABLE "ooda"."attention_reviews" DROP COLUMN IF EXISTS "opportunity";
ALTER TABLE "ooda"."attention_reviews" DROP COLUMN IF EXISTS "overall_score";
