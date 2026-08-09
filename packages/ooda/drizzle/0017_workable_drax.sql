ALTER TABLE "ooda"."host_turn_executions" ADD COLUMN "preferred_provider" varchar(32);--> statement-breakpoint
ALTER TABLE "ooda"."host_turn_executions" ADD COLUMN "context_pack_id" uuid;--> statement-breakpoint
ALTER TABLE "ooda"."host_turn_executions" ADD COLUMN "auth_mode" varchar(32);--> statement-breakpoint
ALTER TABLE "ooda"."host_turn_executions" ADD COLUMN "native_session_id" text;--> statement-breakpoint
ALTER TABLE "ooda"."host_turn_executions" ADD COLUMN "native_turn_id" text;--> statement-breakpoint
ALTER TABLE "ooda"."host_turn_executions" ADD COLUMN "runtime_transport" varchar(32);--> statement-breakpoint
ALTER TABLE "ooda"."host_turn_executions" ADD COLUMN "error" text;--> statement-breakpoint
ALTER TABLE "ooda"."host_turn_executions" ADD COLUMN "claimed_by" text;--> statement-breakpoint
ALTER TABLE "ooda"."host_turn_executions" ADD COLUMN "lease_token" uuid;--> statement-breakpoint
ALTER TABLE "ooda"."host_turn_executions" ADD COLUMN "attempt" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "ooda"."host_turn_executions" ADD COLUMN "lease_duration_seconds" integer DEFAULT 90 NOT NULL;--> statement-breakpoint
ALTER TABLE "ooda"."host_turn_executions" ADD COLUMN "last_heartbeat_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "ooda"."host_turn_executions" ADD COLUMN "completion_idempotency_key" text;--> statement-breakpoint
ALTER TABLE "ooda"."host_turn_executions" ADD COLUMN "completion_fingerprint" text;--> statement-breakpoint
CREATE UNIQUE INDEX "host_turn_executions_completion_idempotency_uidx" ON "ooda"."host_turn_executions" USING btree ("completion_idempotency_key");