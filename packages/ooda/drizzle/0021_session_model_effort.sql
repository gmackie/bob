-- Per-session model and reasoning effort requested by the dispatcher.
-- Nullable and additive: sessions without them run on the adapter default.
ALTER TABLE "runner_session" ADD COLUMN IF NOT EXISTS "model" varchar(128);--> statement-breakpoint
ALTER TABLE "runner_session" ADD COLUMN IF NOT EXISTS "reasoning_effort" varchar(16);
