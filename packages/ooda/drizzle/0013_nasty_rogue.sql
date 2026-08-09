DROP INDEX "ooda"."dead_letters_outbox_uidx";--> statement-breakpoint
ALTER TABLE "ooda"."dead_letters" ADD COLUMN "repair_idempotency_key" text;--> statement-breakpoint
ALTER TABLE "ooda"."integration_outbox" ADD COLUMN "last_error" text;--> statement-breakpoint
CREATE INDEX "dead_letters_outbox_idx" ON "ooda"."dead_letters" USING btree ("outbox_id");--> statement-breakpoint
CREATE UNIQUE INDEX "dead_letters_repair_idempotency_uidx" ON "ooda"."dead_letters" USING btree ("repair_idempotency_key");