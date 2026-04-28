CREATE TYPE "work_item_activity_type" AS ENUM (
  'comment_added',
  'status_changed',
  'artifact_added',
  'notification_created'
);

CREATE TYPE "work_item_notification_type" AS ENUM (
  'work_item_assigned',
  'work_item_commented',
  'work_item_needs_input',
  'work_item_review_ready'
);

CREATE TYPE "work_item_artifact_type" AS ENUM (
  'pr',
  'verification',
  'build',
  'test_report',
  'doc',
  'deliverable',
  'other'
);

CREATE TYPE "work_item_artifact_producer_type" AS ENUM (
  'bob',
  'forgegraph',
  'human',
  'system'
);

CREATE TABLE "comments" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "work_item_id" uuid NOT NULL,
  "user_id" text NOT NULL,
  "parent_id" uuid,
  "body" text NOT NULL,
  "body_html" text,
  "edited" boolean DEFAULT false NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone
);

CREATE TABLE "activities" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "work_item_id" uuid NOT NULL,
  "user_id" text,
  "type" "work_item_activity_type" NOT NULL,
  "from_value" text,
  "to_value" text,
  "metadata" jsonb,
  "created_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE "work_item_artifacts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "work_item_id" uuid NOT NULL,
  "task_run_id" uuid,
  "producer_type" "work_item_artifact_producer_type" NOT NULL,
  "producer_id" text,
  "artifact_type" "work_item_artifact_type" NOT NULL,
  "artifact_role" text NOT NULL,
  "url" text NOT NULL,
  "title" text,
  "summary" text,
  "metadata" jsonb,
  "is_current" boolean DEFAULT true NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE "notifications" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" text NOT NULL,
  "work_item_id" uuid,
  "actor_id" text,
  "type" "work_item_notification_type" NOT NULL,
  "title" text NOT NULL,
  "body" text,
  "url" text,
  "read" boolean DEFAULT false NOT NULL,
  "read_at" timestamp with time zone,
  "archived_at" timestamp with time zone,
  "created_at" timestamp DEFAULT now() NOT NULL
);

ALTER TABLE "comments"
  ADD CONSTRAINT "comments_work_item_id_work_items_id_fk"
  FOREIGN KEY ("work_item_id") REFERENCES "work_items"("id") ON DELETE CASCADE;

ALTER TABLE "comments"
  ADD CONSTRAINT "comments_user_id_user_id_fk"
  FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;

ALTER TABLE "activities"
  ADD CONSTRAINT "activities_work_item_id_work_items_id_fk"
  FOREIGN KEY ("work_item_id") REFERENCES "work_items"("id") ON DELETE CASCADE;

ALTER TABLE "activities"
  ADD CONSTRAINT "activities_user_id_user_id_fk"
  FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE SET NULL;

ALTER TABLE "work_item_artifacts"
  ADD CONSTRAINT "work_item_artifacts_work_item_id_work_items_id_fk"
  FOREIGN KEY ("work_item_id") REFERENCES "work_items"("id") ON DELETE CASCADE;

ALTER TABLE "work_item_artifacts"
  ADD CONSTRAINT "work_item_artifacts_task_run_id_task_runs_id_fk"
  FOREIGN KEY ("task_run_id") REFERENCES "task_runs"("id") ON DELETE SET NULL;

ALTER TABLE "notifications"
  ADD CONSTRAINT "notifications_user_id_user_id_fk"
  FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;

ALTER TABLE "notifications"
  ADD CONSTRAINT "notifications_work_item_id_work_items_id_fk"
  FOREIGN KEY ("work_item_id") REFERENCES "work_items"("id") ON DELETE CASCADE;

ALTER TABLE "notifications"
  ADD CONSTRAINT "notifications_actor_id_user_id_fk"
  FOREIGN KEY ("actor_id") REFERENCES "user"("id") ON DELETE SET NULL;
