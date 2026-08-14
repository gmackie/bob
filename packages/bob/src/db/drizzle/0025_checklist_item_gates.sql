-- Checklist-driven agent execution: per-item gates + session/gate state on
-- plan_task_items. All columns are additive and nullable (or defaulted), so this
-- is a safe forward-only migration. See advanceChecklist / advanceChecklist-core.
ALTER TABLE "plan_task_items" ADD COLUMN IF NOT EXISTS "gate" jsonb;
ALTER TABLE "plan_task_items" ADD COLUMN IF NOT EXISTS "acceptance_criteria" text;
ALTER TABLE "plan_task_items" ADD COLUMN IF NOT EXISTS "gate_attempts" integer DEFAULT 0 NOT NULL;
ALTER TABLE "plan_task_items" ADD COLUMN IF NOT EXISTS "session_id" uuid;
ALTER TABLE "plan_task_items" ADD COLUMN IF NOT EXISTS "gate_outcome" varchar(10);
