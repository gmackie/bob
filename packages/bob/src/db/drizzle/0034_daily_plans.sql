-- The daily loop: a plan per workspace per UTC day, plus the two notification
-- types that announce it. See packages/bob/src/schema/src/work-items.ts
-- (dailyPlans) for what each column means.

-- ADD VALUE is safe inside a transaction on PostgreSQL 12+ as long as the new
-- value is not used in the same transaction, which this migration does not do.
ALTER TYPE "work_item_notification_type" ADD VALUE IF NOT EXISTS 'daily_plan_ready';
ALTER TYPE "work_item_notification_type" ADD VALUE IF NOT EXISTS 'daily_review_ready';

CREATE TABLE IF NOT EXISTS "daily_plans" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "workspace_id" uuid NOT NULL,
  "plan_date" varchar(10) NOT NULL,
  "status" varchar(16) NOT NULL DEFAULT 'draft',
  "summary" text NOT NULL DEFAULT '',
  "items" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "intake" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "review" jsonb,
  "review_summary" text,
  "capacity" integer NOT NULL DEFAULT 0,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "approved_at" timestamptz,
  "approved_by_user_id" text,
  "closed_at" timestamptz,
  "updated_at" timestamptz
);

-- One plan per workspace per day; the morning cron upserts on this.
CREATE UNIQUE INDEX IF NOT EXISTS "daily_plans_workspace_date_uidx"
  ON "daily_plans" ("workspace_id", "plan_date");
