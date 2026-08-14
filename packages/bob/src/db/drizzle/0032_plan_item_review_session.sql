-- Reviewer-gate tier: track the review session dispatched to judge a checklist
-- item's work so the advanceChecklist driver can map its terminal outcome
-- (finished-ok → pass, failed → fail) into plan_task_items.gate_outcome.
-- Additive + nullable — safe forward-only migration.
ALTER TABLE "plan_task_items" ADD COLUMN IF NOT EXISTS "gate_review_session_id" uuid;
