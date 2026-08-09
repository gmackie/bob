ALTER TABLE "ooda"."proposals" ADD COLUMN "idempotency_key" text;--> statement-breakpoint
ALTER TABLE "ooda"."proposals" ADD COLUMN "command_fingerprint" text;--> statement-breakpoint
UPDATE "ooda"."proposals" SET "idempotency_key" = 'legacy:' || "id"::text, "command_fingerprint" = 'legacy:' || "id"::text WHERE "idempotency_key" IS NULL OR "command_fingerprint" IS NULL;--> statement-breakpoint
ALTER TABLE "ooda"."proposals" ALTER COLUMN "idempotency_key" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "ooda"."proposals" ALTER COLUMN "command_fingerprint" SET NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "proposals_conversation_idempotency_uidx" ON "ooda"."proposals" USING btree ("conversation_id","idempotency_key");
