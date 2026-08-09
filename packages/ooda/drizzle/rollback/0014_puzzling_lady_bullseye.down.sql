ALTER TABLE "ooda"."agent_jobs" DROP COLUMN IF EXISTS "lease_duration_seconds";
ALTER TABLE "ooda"."agent_jobs" DROP COLUMN IF EXISTS "lease_token";
ALTER TABLE "ooda"."agent_jobs" DROP COLUMN IF EXISTS "attempt";
ALTER TABLE "ooda"."agent_jobs" DROP COLUMN IF EXISTS "native_turn_id";
ALTER TABLE "ooda"."agent_jobs" DROP COLUMN IF EXISTS "native_session_id";
ALTER TABLE "ooda"."agent_jobs" DROP COLUMN IF EXISTS "auth_mode";
ALTER TABLE "ooda"."agent_jobs" DROP COLUMN IF EXISTS "billing_policy";
