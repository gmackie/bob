ALTER TABLE "ooda"."attention_reviews" ADD COLUMN "overall_score" real;--> statement-breakpoint
ALTER TABLE "ooda"."attention_reviews" ADD COLUMN "opportunity" jsonb;--> statement-breakpoint
ALTER TABLE "ooda"."attention_reviews" ADD COLUMN "idempotency_key" text;--> statement-breakpoint
ALTER TABLE "ooda"."attention_reviews" ADD COLUMN "command_fingerprint" text;--> statement-breakpoint
UPDATE "ooda"."attention_reviews"
SET
  "overall_score" = COALESCE("overall_score", 0),
  "opportunity" = COALESCE("opportunity", '{}'::jsonb),
  "idempotency_key" = COALESCE("idempotency_key", 'legacy:' || "id"::text),
  "command_fingerprint" = COALESCE("command_fingerprint", 'legacy:' || "id"::text);--> statement-breakpoint
ALTER TABLE "ooda"."attention_reviews" ALTER COLUMN "overall_score" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "ooda"."attention_reviews" ALTER COLUMN "opportunity" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "ooda"."attention_reviews" ALTER COLUMN "idempotency_key" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "ooda"."attention_reviews" ALTER COLUMN "command_fingerprint" SET NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "attention_reviews_memory_idempotency_uidx" ON "ooda"."attention_reviews" USING btree ("memory_seed_id","idempotency_key");
