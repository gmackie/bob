CREATE TYPE IF NOT EXISTS issue_funnel_tshirt_size AS ENUM (
  'xs',
  's',
  'm',
  'l',
  'xl',
  'xxl'
);

ALTER TYPE outbound_webhook_event
  ADD VALUE IF NOT EXISTS 'issue.funnel_stage_changed';

ALTER TYPE activity_type
  ADD VALUE IF NOT EXISTS 'funnel_stage_changed';

ALTER TABLE "issues"
  ADD COLUMN IF NOT EXISTS "funnel_tshirt_size" issue_funnel_tshirt_size;

CREATE INDEX IF NOT EXISTS "issues_funnel_tshirt_size_idx" ON "issues" USING btree ("funnel_tshirt_size");
