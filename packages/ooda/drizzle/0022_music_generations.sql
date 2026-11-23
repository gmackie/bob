-- Ledger of paid music generations (BOB-52). Additive: a new table only.
CREATE TABLE IF NOT EXISTS "ooda"."music_generations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"model" varchar(64) NOT NULL,
	"prompt_sha256" varchar(64) NOT NULL,
	"status" varchar(16) NOT NULL,
	"cost_usd_micros" integer NOT NULL,
	"error_code" varchar(64),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "music_generations_owner_idempotency_uidx" ON "ooda"."music_generations" USING btree ("owner_id","idempotency_key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "music_generations_created_idx" ON "ooda"."music_generations" USING btree ("created_at");
