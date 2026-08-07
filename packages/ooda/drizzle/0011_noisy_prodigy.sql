ALTER TABLE "ooda"."agent_job_events" ADD COLUMN "idempotency_key" text;--> statement-breakpoint
UPDATE "ooda"."agent_job_events" SET "idempotency_key" = 'legacy:' || "id"::text WHERE "idempotency_key" IS NULL;--> statement-breakpoint
ALTER TABLE "ooda"."agent_job_events" ALTER COLUMN "idempotency_key" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "ooda"."agent_jobs" ADD COLUMN "last_sequence" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "ooda"."agent_jobs" ADD COLUMN "claimed_by" text;--> statement-breakpoint
ALTER TABLE "ooda"."agent_jobs" ADD COLUMN "lease_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "ooda"."agent_jobs" ADD COLUMN "last_heartbeat_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "ooda"."agent_jobs" ADD COLUMN "cancellation_requested_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "ooda"."agent_jobs" ADD COLUMN "cancel_idempotency_key" text;--> statement-breakpoint
ALTER TABLE "ooda"."agent_jobs" ADD COLUMN "tokens_used" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "agent_job_events_job_idempotency_uidx" ON "ooda"."agent_job_events" USING btree ("agent_job_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "agent_jobs_status_lease_idx" ON "ooda"."agent_jobs" USING btree ("status","lease_expires_at");
