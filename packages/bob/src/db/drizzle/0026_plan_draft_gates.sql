-- Phase 2 bridge: per-draft gate + acceptance criteria on plan_drafts, carried
-- into plan_task_items when a planning session is committed as a gated
-- checklist. Additive + nullable — safe forward-only migration.
ALTER TABLE "plan_drafts" ADD COLUMN IF NOT EXISTS "gate" jsonb;
ALTER TABLE "plan_drafts" ADD COLUMN IF NOT EXISTS "acceptance_criteria" text;
