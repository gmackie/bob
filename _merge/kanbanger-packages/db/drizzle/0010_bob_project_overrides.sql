CREATE TYPE "public"."bob_launch_policy" AS ENUM('auto_or_manual', 'manual_only');

ALTER TABLE "projects"
  ADD COLUMN IF NOT EXISTS "bob_launch_policy" "bob_launch_policy",
  ADD COLUMN IF NOT EXISTS "bob_awaiting_input_timeout_minutes" integer;

CREATE INDEX IF NOT EXISTS "projects_bob_launch_policy_idx" ON "projects" USING btree ("bob_launch_policy");
