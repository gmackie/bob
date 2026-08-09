DROP INDEX IF EXISTS "ooda"."memory_edges_feedback_idempotency_uidx";
ALTER TABLE "ooda"."memory_edges" DROP COLUMN IF EXISTS "feedback_fingerprint";
ALTER TABLE "ooda"."memory_edges" DROP COLUMN IF EXISTS "feedback_idempotency_key";
