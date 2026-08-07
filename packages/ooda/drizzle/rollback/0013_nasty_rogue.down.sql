DROP INDEX IF EXISTS "ooda"."dead_letters_repair_idempotency_uidx";
DROP INDEX IF EXISTS "ooda"."dead_letters_outbox_idx";
CREATE UNIQUE INDEX "dead_letters_outbox_uidx" ON "ooda"."dead_letters" ("outbox_id");
ALTER TABLE "ooda"."dead_letters" DROP COLUMN IF EXISTS "repair_idempotency_key";
ALTER TABLE "ooda"."integration_outbox" DROP COLUMN IF EXISTS "last_error";
