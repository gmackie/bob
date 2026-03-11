CREATE TYPE "public"."execution_backend" AS ENUM('bob');
CREATE TYPE "public"."issue_artifact_type" AS ENUM('pr', 'verification', 'build', 'test_report', 'doc', 'deliverable', 'other');
CREATE TYPE "public"."issue_artifact_producer_type" AS ENUM('bob', 'forgegraph', 'human', 'system');

ALTER TYPE "public"."integration_type" ADD VALUE IF NOT EXISTS 'bob';
ALTER TYPE "public"."agent_task_run_status" ADD VALUE IF NOT EXISTS 'failed_to_start';
ALTER TYPE "public"."agent_task_run_status" ADD VALUE IF NOT EXISTS 'superseded';

ALTER TABLE "agent_sessions"
  ADD COLUMN IF NOT EXISTS "execution_backend" "execution_backend" DEFAULT 'bob' NOT NULL,
  ADD COLUMN IF NOT EXISTS "external_session_id" text,
  ADD COLUMN IF NOT EXISTS "external_session_url" text,
  ADD COLUMN IF NOT EXISTS "workflow_status" text,
  ADD COLUMN IF NOT EXISTS "last_synced_at" timestamp with time zone;

ALTER TABLE "agent_task_runs"
  ADD COLUMN IF NOT EXISTS "execution_backend" "execution_backend" DEFAULT 'bob' NOT NULL,
  ADD COLUMN IF NOT EXISTS "external_session_id" text,
  ADD COLUMN IF NOT EXISTS "external_session_url" text,
  ADD COLUMN IF NOT EXISTS "latest_summary" text,
  ADD COLUMN IF NOT EXISTS "last_prompt_comment_id" uuid,
  ADD COLUMN IF NOT EXISTS "review_url" text,
  ADD COLUMN IF NOT EXISTS "artifact_refs" jsonb,
  ADD COLUMN IF NOT EXISTS "completion_source" text,
  ADD COLUMN IF NOT EXISTS "superseded_at" timestamp with time zone,
  ADD COLUMN IF NOT EXISTS "superseded_reason" text;

CREATE TABLE IF NOT EXISTS "issue_artifacts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "issue_id" uuid NOT NULL,
  "agent_task_run_id" uuid,
  "execution_backend" "execution_backend" DEFAULT 'bob' NOT NULL,
  "producer_type" "issue_artifact_producer_type" NOT NULL,
  "producer_id" text,
  "artifact_type" "issue_artifact_type" NOT NULL,
  "artifact_role" text NOT NULL,
  "url" text NOT NULL,
  "title" text,
  "summary" text,
  "metadata" jsonb,
  "is_current" boolean DEFAULT true NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

DO $$ BEGIN
 ALTER TABLE "issue_artifacts" ADD CONSTRAINT "issue_artifacts_issue_id_issues_id_fk"
 FOREIGN KEY ("issue_id") REFERENCES "public"."issues"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
 ALTER TABLE "issue_artifacts" ADD CONSTRAINT "issue_artifacts_agent_task_run_id_agent_task_runs_id_fk"
 FOREIGN KEY ("agent_task_run_id") REFERENCES "public"."agent_task_runs"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

CREATE INDEX IF NOT EXISTS "issue_artifacts_issue_idx" ON "issue_artifacts" USING btree ("issue_id");
CREATE INDEX IF NOT EXISTS "issue_artifacts_run_idx" ON "issue_artifacts" USING btree ("agent_task_run_id");
CREATE INDEX IF NOT EXISTS "issue_artifacts_current_idx" ON "issue_artifacts" USING btree ("issue_id", "is_current");
CREATE INDEX IF NOT EXISTS "issue_artifacts_type_idx" ON "issue_artifacts" USING btree ("artifact_type");
CREATE INDEX IF NOT EXISTS "issue_artifacts_role_idx" ON "issue_artifacts" USING btree ("artifact_role");
