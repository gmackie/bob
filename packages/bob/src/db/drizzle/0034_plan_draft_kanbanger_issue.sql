-- A planning_drafts event creates the provider issue before the draft is
-- committed. The issue id makes a redelivery skip createIssue. work_item_id
-- is the local row Bob runs.
ALTER TABLE "plan_drafts" ADD COLUMN IF NOT EXISTS "kanbanger_issue_id" text;
ALTER TABLE "plan_drafts" ADD COLUMN IF NOT EXISTS "kanbanger_issue_identifier" text;
ALTER TABLE "plan_drafts" ADD COLUMN IF NOT EXISTS "work_item_id" uuid;
