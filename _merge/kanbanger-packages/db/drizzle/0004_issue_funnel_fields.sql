CREATE TYPE IF NOT EXISTS issue_funnel_source_type AS ENUM (
  'manual',
  'sentry',
  'ticket',
  'forgegraph',
  'api'
);

CREATE TYPE IF NOT EXISTS issue_funnel_artifact_type AS ENUM (
  'idea',
  'plan',
  'brd',
  'spec',
  'task',
  'pr'
);

CREATE TYPE IF NOT EXISTS issue_funnel_stage AS ENUM (
  'dumped',
  'triaged',
  'planned',
  'designed',
  'ready_for_execution',
  'picked_up'
);

ALTER TABLE "issues"
  ADD COLUMN IF NOT EXISTS "funnel_source_type" issue_funnel_source_type NOT NULL DEFAULT 'manual';

ALTER TABLE "issues"
  ADD COLUMN IF NOT EXISTS "funnel_source_id" text;

ALTER TABLE "issues"
  ADD COLUMN IF NOT EXISTS "funnel_source_url" text;

ALTER TABLE "issues"
  ADD COLUMN IF NOT EXISTS "funnel_artifact_type" issue_funnel_artifact_type NOT NULL DEFAULT 'task';

ALTER TABLE "issues"
  ADD COLUMN IF NOT EXISTS "funnel_stage" issue_funnel_stage NOT NULL DEFAULT 'dumped';

ALTER TABLE "issues"
  ADD COLUMN IF NOT EXISTS "funnel_metadata" jsonb;

CREATE INDEX IF NOT EXISTS "issues_funnel_source_type_idx" ON "issues" USING btree ("funnel_source_type");

CREATE INDEX IF NOT EXISTS "issues_funnel_artifact_type_idx" ON "issues" USING btree ("funnel_artifact_type");

CREATE INDEX IF NOT EXISTS "issues_funnel_stage_idx" ON "issues" USING btree ("funnel_stage");
