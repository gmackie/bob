DROP INDEX IF EXISTS "ooda"."proposals_conversation_idempotency_uidx";
ALTER TABLE "ooda"."proposals" DROP COLUMN IF EXISTS "command_fingerprint";
ALTER TABLE "ooda"."proposals" DROP COLUMN IF EXISTS "idempotency_key";
