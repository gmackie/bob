CREATE TYPE "public"."forge_build_status" AS ENUM('queued', 'running', 'passed', 'failed', 'canceled', 'superseded');--> statement-breakpoint
CREATE TYPE "public"."forge_deployment_status" AS ENUM('pending_approval', 'deploying', 'healthy', 'unhealthy', 'rolled_back', 'failed');--> statement-breakpoint
CREATE TYPE "public"."forge_environment" AS ENUM('dev', 'staging', 'prod', 'preview');--> statement-breakpoint
CREATE TABLE "forge_build_artifacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"build_id" uuid NOT NULL,
	"type" text NOT NULL,
	"digest" text,
	"storage_key" text NOT NULL,
	"size_bytes" integer,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "forge_build_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"build_id" uuid NOT NULL,
	"event_type" text NOT NULL,
	"payload" jsonb,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "forge_builds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"repo_id" text NOT NULL,
	"rev_id" text NOT NULL,
	"run_id" text,
	"task_id" uuid,
	"status" "forge_build_status" DEFAULT 'queued' NOT NULL,
	"idempotency_key" text NOT NULL,
	"ci_provider" text DEFAULT 'github_actions',
	"external_job_id" text,
	"artifact_manifest_ref" text,
	"image_digest" text,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"superseded_by_build_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "forge_deployments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"repo_id" text NOT NULL,
	"rev_id" text NOT NULL,
	"build_id" uuid NOT NULL,
	"environment" "forge_environment" NOT NULL,
	"status" "forge_deployment_status" DEFAULT 'pending_approval' NOT NULL,
	"rollback_target_deployment_id" uuid,
	"deployed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "forge_previews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"repo_id" text NOT NULL,
	"rev_id" text NOT NULL,
	"url" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"expires_at" timestamp with time zone,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "forge_build_artifacts" ADD CONSTRAINT "forge_build_artifacts_build_id_forge_builds_id_fk" FOREIGN KEY ("build_id") REFERENCES "public"."forge_builds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forge_build_events" ADD CONSTRAINT "forge_build_events_build_id_forge_builds_id_fk" FOREIGN KEY ("build_id") REFERENCES "public"."forge_builds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forge_builds" ADD CONSTRAINT "forge_builds_task_id_issues_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."issues"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forge_deployments" ADD CONSTRAINT "forge_deployments_build_id_forge_builds_id_fk" FOREIGN KEY ("build_id") REFERENCES "public"."forge_builds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "forge_build_artifacts_build_idx" ON "forge_build_artifacts" USING btree ("build_id");--> statement-breakpoint
CREATE INDEX "forge_build_artifacts_type_idx" ON "forge_build_artifacts" USING btree ("type");--> statement-breakpoint
CREATE INDEX "forge_build_artifacts_digest_idx" ON "forge_build_artifacts" USING btree ("digest");--> statement-breakpoint
CREATE INDEX "forge_build_events_build_idx" ON "forge_build_events" USING btree ("build_id");--> statement-breakpoint
CREATE INDEX "forge_build_events_type_idx" ON "forge_build_events" USING btree ("event_type");--> statement-breakpoint
CREATE INDEX "forge_build_events_occurred_idx" ON "forge_build_events" USING btree ("occurred_at");--> statement-breakpoint
CREATE INDEX "forge_builds_repo_idx" ON "forge_builds" USING btree ("repo_id");--> statement-breakpoint
CREATE INDEX "forge_builds_rev_idx" ON "forge_builds" USING btree ("rev_id");--> statement-breakpoint
CREATE INDEX "forge_builds_run_idx" ON "forge_builds" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "forge_builds_task_idx" ON "forge_builds" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX "forge_builds_status_idx" ON "forge_builds" USING btree ("status");--> statement-breakpoint
CREATE INDEX "forge_builds_idempotency_idx" ON "forge_builds" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "forge_builds_superseded_idx" ON "forge_builds" USING btree ("superseded_by_build_id");--> statement-breakpoint
CREATE INDEX "forge_deployments_repo_idx" ON "forge_deployments" USING btree ("repo_id");--> statement-breakpoint
CREATE INDEX "forge_deployments_rev_idx" ON "forge_deployments" USING btree ("rev_id");--> statement-breakpoint
CREATE INDEX "forge_deployments_build_idx" ON "forge_deployments" USING btree ("build_id");--> statement-breakpoint
CREATE INDEX "forge_deployments_env_idx" ON "forge_deployments" USING btree ("environment");--> statement-breakpoint
CREATE INDEX "forge_deployments_status_idx" ON "forge_deployments" USING btree ("status");--> statement-breakpoint
CREATE INDEX "forge_deployments_rollback_idx" ON "forge_deployments" USING btree ("rollback_target_deployment_id");--> statement-breakpoint
CREATE INDEX "forge_previews_repo_idx" ON "forge_previews" USING btree ("repo_id");--> statement-breakpoint
CREATE INDEX "forge_previews_rev_idx" ON "forge_previews" USING btree ("rev_id");--> statement-breakpoint
CREATE INDEX "forge_previews_status_idx" ON "forge_previews" USING btree ("status");--> statement-breakpoint
CREATE INDEX "forge_previews_expires_idx" ON "forge_previews" USING btree ("expires_at");