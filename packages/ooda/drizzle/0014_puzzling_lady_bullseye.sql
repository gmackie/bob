ALTER TABLE "ooda"."agent_jobs" ADD COLUMN "billing_policy" varchar(32) DEFAULT 'subscription_only' NOT NULL;--> statement-breakpoint
ALTER TABLE "ooda"."agent_jobs" ADD COLUMN "auth_mode" varchar(32);--> statement-breakpoint
ALTER TABLE "ooda"."agent_jobs" ADD COLUMN "native_session_id" text;--> statement-breakpoint
ALTER TABLE "ooda"."agent_jobs" ADD COLUMN "native_turn_id" text;--> statement-breakpoint
ALTER TABLE "ooda"."agent_jobs" ADD COLUMN "attempt" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "ooda"."agent_jobs" ADD COLUMN "lease_token" uuid;--> statement-breakpoint
ALTER TABLE "ooda"."agent_jobs" ADD COLUMN "lease_duration_seconds" integer DEFAULT 90 NOT NULL;