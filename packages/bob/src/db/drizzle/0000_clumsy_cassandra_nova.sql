CREATE TYPE "public"."tenant_member_role" AS ENUM('owner', 'admin', 'member');--> statement-breakpoint
CREATE TYPE "public"."tenant_plan" AS ENUM('free', 'premium', 'pro');--> statement-breakpoint
CREATE TYPE "public"."workspace_member_role" AS ENUM('owner', 'admin', 'member', 'viewer');--> statement-breakpoint
CREATE TYPE "public"."project_status" AS ENUM('planned', 'active', 'in_progress', 'paused', 'completed', 'archived');--> statement-breakpoint
CREATE TYPE "public"."work_item_activity_type" AS ENUM('comment_added', 'status_changed', 'artifact_added', 'notification_created', 'build_status_changed', 'deploy_status_changed', 'planning_session_completed', 'review_requested', 'review_approved', 'review_changes_requested');--> statement-breakpoint
CREATE TYPE "public"."work_item_artifact_producer_type" AS ENUM('bob', 'forgegraph', 'human', 'system');--> statement-breakpoint
CREATE TYPE "public"."work_item_artifact_type" AS ENUM('pr', 'verification', 'build', 'test_report', 'doc', 'deliverable', 'planning_doc', 'code_review', 'other');--> statement-breakpoint
CREATE TYPE "public"."work_item_kind" AS ENUM('issue', 'epic', 'task');--> statement-breakpoint
CREATE TYPE "public"."work_item_notification_type" AS ENUM('work_item_assigned', 'work_item_commented', 'work_item_needs_input', 'work_item_review_ready', 'task_completed', 'batch_completed');--> statement-breakpoint
CREATE TYPE "public"."agent_run_status" AS ENUM('queued', 'running', 'completed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."run_artifact_type" AS ENUM('diff', 'log', 'test-report', 'file-snapshot');--> statement-breakpoint
CREATE TYPE "public"."skill_category" AS ENUM('planning', 'execution', 'review', 'deploy', 'ops', 'other');--> statement-breakpoint
CREATE TYPE "public"."skill_execution_status" AS ENUM('running', 'completed', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."skill_source" AS ENUM('builtin', 'gstack', 'custom');--> statement-breakpoint
CREATE TYPE "public"."pr_review_status" AS ENUM('approved', 'changes_requested', 'commented');--> statement-breakpoint
CREATE TABLE "accounts" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"account_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"password" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"token" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sessions_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verifications" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "api_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"name" varchar(100) NOT NULL,
	"key_hash" text NOT NULL,
	"key_prefix" varchar(12) NOT NULL,
	"permissions" json DEFAULT '["read"]'::json NOT NULL,
	"last_used_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "device_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"device_code" uuid DEFAULT gen_random_uuid() NOT NULL,
	"user_code" varchar(16) NOT NULL,
	"api_key" text,
	"user_id" text,
	"status" varchar(16) DEFAULT 'pending' NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "device_codes_device_code_unique" UNIQUE("device_code"),
	CONSTRAINT "device_codes_user_code_unique" UNIQUE("user_code")
);
--> statement-breakpoint
CREATE TABLE "tenant_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"role" "tenant_member_role" DEFAULT 'member' NOT NULL,
	"joined_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tenants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(128) NOT NULL,
	"slug" varchar(64) NOT NULL,
	"plan" "tenant_plan" DEFAULT 'free' NOT NULL,
	"forge_graph_project_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "tenants_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "workspace_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"role" "workspace_member_role" DEFAULT 'member' NOT NULL,
	"joined_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workspaces" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" text NOT NULL,
	"name" varchar(128) NOT NULL,
	"slug" varchar(64) NOT NULL,
	"description" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone,
	"tenant_id" uuid,
	"machine_id" text,
	"last_heartbeat" timestamp,
	"agent_configs" json,
	"forge_available" boolean DEFAULT false,
	"forge_api_key" text,
	"dev_dir" text,
	CONSTRAINT "workspaces_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "user_preferences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"theme" varchar(20) DEFAULT 'system' NOT NULL,
	"language" varchar(10) DEFAULT 'en' NOT NULL,
	"timezone" varchar(50) DEFAULT 'UTC' NOT NULL,
	"email_notifications" boolean DEFAULT true NOT NULL,
	"push_notifications" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone,
	CONSTRAINT "user_preferences_userId_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "discovered_dirs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"path" text NOT NULL,
	"name" varchar(256) NOT NULL,
	"dismissed" boolean DEFAULT false,
	"last_seen" timestamp DEFAULT now(),
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"lead_user_id" text,
	"forge_graph_app_id" text,
	"repo_url" text,
	"default_branch" text,
	"name" varchar(128) NOT NULL,
	"key" varchar(16) NOT NULL,
	"description" text,
	"color" varchar(7),
	"status" "project_status" DEFAULT 'planned' NOT NULL,
	"automation_settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"planning_provider" varchar(20) DEFAULT 'internal' NOT NULL,
	"linear_project_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone,
	CONSTRAINT "projects_forgeGraphAppId_unique" UNIQUE("forge_graph_app_id")
);
--> statement-breakpoint
CREATE TABLE "repositories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"kanbanger_project_id" text,
	"name" varchar(256) NOT NULL,
	"path" text NOT NULL,
	"branch" varchar(256) NOT NULL,
	"main_branch" varchar(256) DEFAULT 'main' NOT NULL,
	"remote_url" text,
	"remote_provider" varchar(20),
	"remote_owner" text,
	"remote_name" text,
	"remote_instance_url" text,
	"git_provider_connection_id" uuid,
	"workspace_id" uuid,
	"build_system" varchar(32),
	"dirty" boolean DEFAULT false,
	"stale" boolean DEFAULT false,
	"discovery_status" varchar(16) DEFAULT 'discovered',
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "workspace_integrations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"provider" varchar(20) NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"api_key" text,
	"webhook_signing_secret" text,
	"linear_team_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "worktree_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"worktree_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"link_type" varchar(50) NOT NULL,
	"external_id" varchar(256),
	"url" text,
	"title" varchar(256),
	"metadata" json,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "worktree_plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"worktree_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"file_path" text NOT NULL,
	"title" varchar(256),
	"goal" text,
	"status" varchar(20) DEFAULT 'draft' NOT NULL,
	"kanbanger_task_id" varchar(100),
	"last_synced_at" timestamp with time zone,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "worktrees" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"repository_id" uuid NOT NULL,
	"path" text NOT NULL,
	"branch" varchar(256) NOT NULL,
	"preferred_agent" varchar(50) DEFAULT 'claude' NOT NULL,
	"is_main_worktree" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone
);
--> statement-breakpoint
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
--> statement-breakpoint
CREATE TABLE "dispatch_batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"session_id" uuid,
	"workspace_id" text NOT NULL,
	"project_id" text NOT NULL,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"concurrency" integer DEFAULT 2 NOT NULL,
	"total_tasks" integer DEFAULT 0 NOT NULL,
	"completed_tasks" integer DEFAULT 0 NOT NULL,
	"failed_tasks" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "dispatch_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"batch_id" uuid NOT NULL,
	"planning_task_id" text NOT NULL,
	"planning_task_identifier" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"agent_type" varchar(50) DEFAULT 'opencode' NOT NULL,
	"status" varchar(20) DEFAULT 'queued' NOT NULL,
	"blocked_by_items" json DEFAULT '[]'::json,
	"task_run_id" uuid,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"pipeline_state" varchar(30),
	"planning_provider" varchar(20) DEFAULT 'internal' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "plan_draft_dependencies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"draft_id" uuid NOT NULL,
	"depends_on_draft_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "plan_drafts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"title" varchar(256) NOT NULL,
	"description" text,
	"kind" "work_item_kind" DEFAULT 'task' NOT NULL,
	"priority" varchar(20) DEFAULT 'no_priority' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"status" varchar(20) DEFAULT 'draft' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "plan_task_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"plan_id" uuid NOT NULL,
	"task_key" varchar(20) NOT NULL,
	"content" text NOT NULL,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"priority" varchar(10) DEFAULT 'medium' NOT NULL,
	"parent_task_key" varchar(20),
	"sort_order" integer DEFAULT 0 NOT NULL,
	"completed_at" timestamp with time zone,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "requirements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"work_item_id" uuid NOT NULL,
	"category" text DEFAULT 'other' NOT NULL,
	"description" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"linked_task_id" uuid,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "task_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"kanbanger_workspace_id" text NOT NULL,
	"kanbanger_issue_id" text NOT NULL,
	"kanbanger_issue_identifier" text NOT NULL,
	"work_item_id" uuid,
	"work_item_identifier_snapshot" text,
	"session_id" uuid,
	"repository_id" uuid,
	"worktree_id" uuid,
	"pull_request_id" uuid,
	"status" varchar(20) NOT NULL,
	"blocked_reason" text,
	"branch" text,
	"forgegraph_revision_id" text,
	"parent_task_run_id" uuid,
	"run_phase" varchar(20) DEFAULT 'execute' NOT NULL,
	"planning_provider" varchar(20) DEFAULT 'internal' NOT NULL,
	"sync_failures" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "work_item_artifacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"work_item_id" uuid NOT NULL,
	"task_run_id" uuid,
	"producer_type" "work_item_artifact_producer_type" NOT NULL,
	"producer_id" text,
	"artifact_type" "work_item_artifact_type" NOT NULL,
	"artifact_role" text NOT NULL,
	"url" text,
	"title" text,
	"summary" text,
	"content" text,
	"session_id" uuid,
	"metadata" json,
	"is_current" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "work_item_dependencies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"work_item_id" uuid NOT NULL,
	"depends_on_work_item_id" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "work_item_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"work_item_id" uuid NOT NULL,
	"stage" text NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "work_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"parent_id" uuid,
	"owner_user_id" text NOT NULL,
	"assignee_user_id" text,
	"workspace_id" uuid,
	"project_id" uuid,
	"sequence_number" integer DEFAULT 0 NOT NULL,
	"kind" "work_item_kind" NOT NULL,
	"title" varchar(256) NOT NULL,
	"description" text,
	"status" varchar(40) DEFAULT 'draft' NOT NULL,
	"external_id" text,
	"external_provider" varchar(20),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "agent_instances" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"repository_id" uuid NOT NULL,
	"worktree_id" uuid NOT NULL,
	"agent_type" varchar(50) DEFAULT 'claude' NOT NULL,
	"status" varchar(20) DEFAULT 'stopped' NOT NULL,
	"pid" integer,
	"port" integer,
	"error_message" text,
	"last_activity" timestamp with time zone,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "agent_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"work_item_id" text NOT NULL,
	"workspace_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"agent_type" varchar(64) NOT NULL,
	"agent_config" json,
	"status" "agent_run_status" DEFAULT 'queued' NOT NULL,
	"started_at" timestamp,
	"completed_at" timestamp,
	"summary" json,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "daily_usage_stats" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"date" date NOT NULL,
	"total_input_tokens" bigint DEFAULT 0 NOT NULL,
	"total_output_tokens" bigint DEFAULT 0 NOT NULL,
	"total_cache_read_tokens" bigint DEFAULT 0 NOT NULL,
	"total_cache_creation_tokens" bigint DEFAULT 0 NOT NULL,
	"total_cost_usd" numeric(12, 6) DEFAULT '0' NOT NULL,
	"session_count" integer DEFAULT 0 NOT NULL,
	"active_instances" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "daily_usage_stats_date_unique" UNIQUE("date")
);
--> statement-breakpoint
CREATE TABLE "instance_usage_summary" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"instance_id" uuid NOT NULL,
	"worktree_id" uuid NOT NULL,
	"repository_id" uuid NOT NULL,
	"total_input_tokens" bigint DEFAULT 0 NOT NULL,
	"total_output_tokens" bigint DEFAULT 0 NOT NULL,
	"total_cache_read_tokens" bigint DEFAULT 0 NOT NULL,
	"total_cache_creation_tokens" bigint DEFAULT 0 NOT NULL,
	"total_cost_usd" numeric(12, 6) DEFAULT '0' NOT NULL,
	"session_count" integer DEFAULT 0 NOT NULL,
	"first_usage" timestamp NOT NULL,
	"last_usage" timestamp NOT NULL,
	CONSTRAINT "instance_usage_summary_instanceId_unique" UNIQUE("instance_id")
);
--> statement-breakpoint
CREATE TABLE "run_artifacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"type" "run_artifact_type" NOT NULL,
	"storage_key" text NOT NULL,
	"metadata" json,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "run_lifecycle_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_run_id" uuid NOT NULL,
	"work_item_id" uuid,
	"session_id" uuid,
	"event_type" varchar(40) NOT NULL,
	"phase" varchar(20) NOT NULL,
	"metadata" json DEFAULT '{}'::json,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session_checkpoints" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"turn_number" integer NOT NULL,
	"event_seq" integer NOT NULL,
	"label" text,
	"snapshot_data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"git_ref" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"client_id" text NOT NULL,
	"device_type" varchar(20) DEFAULT 'web' NOT NULL,
	"connected_at" timestamp DEFAULT now() NOT NULL,
	"disconnected_at" timestamp with time zone,
	"last_seen_at" timestamp with time zone,
	"last_ack_seq" bigint DEFAULT 0 NOT NULL,
	"ip" text,
	"user_agent" text
);
--> statement-breakpoint
CREATE TABLE "session_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"seq" bigint NOT NULL,
	"direction" varchar(20) NOT NULL,
	"event_type" varchar(30) NOT NULL,
	"payload" json DEFAULT '{}'::json NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "skill_executions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid,
	"skill_id" uuid,
	"skill_slug" text NOT NULL,
	"work_item_id" uuid,
	"parent_execution_id" uuid,
	"status" "skill_execution_status" DEFAULT 'running' NOT NULL,
	"input" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"output" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"findings" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"duration_ms" integer,
	"started_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "skills" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"description" text,
	"category" "skill_category" DEFAULT 'other' NOT NULL,
	"source" "skill_source" DEFAULT 'builtin' NOT NULL,
	"version" text,
	"config_schema" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "skills_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "token_usage_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"instance_id" uuid NOT NULL,
	"worktree_id" uuid NOT NULL,
	"repository_id" uuid NOT NULL,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"cache_read_tokens" integer DEFAULT 0 NOT NULL,
	"cache_creation_tokens" integer DEFAULT 0 NOT NULL,
	"total_cost_usd" numeric(10, 6) DEFAULT '0' NOT NULL,
	"session_start" timestamp NOT NULL,
	"session_end" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chat_attachments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"message_id" uuid,
	"type" text DEFAULT 'image' NOT NULL,
	"url" text NOT NULL,
	"filename" text,
	"mime_type" text,
	"width" integer,
	"height" integer,
	"size_bytes" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chat_conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"repository_id" uuid,
	"worktree_id" uuid,
	"agent_instance_id" uuid,
	"title" varchar(256),
	"working_directory" text,
	"agent_type" varchar(50) DEFAULT 'opencode' NOT NULL,
	"session_type" varchar(20) DEFAULT 'execution' NOT NULL,
	"opencode_session_id" text,
	"status" varchar(20) DEFAULT 'stopped' NOT NULL,
	"next_seq" bigint DEFAULT 1 NOT NULL,
	"last_activity_at" timestamp with time zone,
	"last_error" json,
	"claimed_by_gateway_id" text,
	"lease_expires_at" timestamp with time zone,
	"git_branch" text,
	"pull_request_id" uuid,
	"kanbanger_task_id" text,
	"work_item_id" uuid,
	"work_item_identifier_snapshot" text,
	"blocked_reason" text,
	"workflow_status" varchar(30) DEFAULT 'started' NOT NULL,
	"status_message" text,
	"awaiting_input_question" text,
	"awaiting_input_options" json,
	"awaiting_input_default" text,
	"awaiting_input_expires_at" timestamp with time zone,
	"awaiting_input_resolved_at" timestamp with time zone,
	"awaiting_input_resolution" json,
	"planning_session_type" varchar(30),
	"planning_workspace_id" uuid,
	"planning_project_id" uuid,
	"planning_project_name" text,
	"planning_launch_context" json,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "chat_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"role" varchar(20) NOT NULL,
	"content" text NOT NULL,
	"tool_calls" json,
	"tool_call_id" varchar(100),
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "feature_branch_task_prs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"feature_branch_id" uuid NOT NULL,
	"pull_request_id" uuid NOT NULL,
	"merged_at" timestamp with time zone,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "feature_branches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"work_item_id" uuid NOT NULL,
	"repository_id" uuid NOT NULL,
	"branch_name" text NOT NULL,
	"base_branch" text DEFAULT 'main' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"feature_pr_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "git_commits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"repository_id" uuid,
	"pull_request_id" uuid,
	"provider" varchar(20) NOT NULL,
	"instance_url" text,
	"remote_owner" text NOT NULL,
	"remote_name" text NOT NULL,
	"sha" varchar(40) NOT NULL,
	"message" text NOT NULL,
	"author_name" text,
	"author_email" text,
	"committed_at" timestamp with time zone NOT NULL,
	"session_id" uuid,
	"is_bob_commit" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "git_provider_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"provider" varchar(20) NOT NULL,
	"instance_url" text,
	"provider_account_id" text NOT NULL,
	"provider_username" text,
	"scopes" text,
	"access_token_ciphertext" text NOT NULL,
	"access_token_iv" text NOT NULL,
	"access_token_tag" text NOT NULL,
	"refresh_token_ciphertext" text,
	"refresh_token_iv" text,
	"refresh_token_tag" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "pr_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pull_request_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"status" "pr_review_status" NOT NULL,
	"body" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pull_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"repository_id" uuid,
	"git_provider_connection_id" uuid,
	"provider" varchar(20) NOT NULL,
	"instance_url" text,
	"remote_owner" text NOT NULL,
	"remote_name" text NOT NULL,
	"number" integer NOT NULL,
	"head_branch" text NOT NULL,
	"base_branch" text NOT NULL,
	"title" text NOT NULL,
	"body" text,
	"status" varchar(20) NOT NULL,
	"url" text NOT NULL,
	"session_id" uuid,
	"kanbanger_task_id" text,
	"additions" integer,
	"deletions" integer,
	"changed_files" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone,
	"merged_at" timestamp with time zone,
	"closed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "webhook_configs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"workspace_id" uuid,
	"url" text NOT NULL,
	"secret" text NOT NULL,
	"events" json DEFAULT '[]'::json NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"description" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "webhook_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"webhook_config_id" uuid,
	"provider" varchar(20) NOT NULL,
	"delivery_id" text,
	"event_type" varchar(50) NOT NULL,
	"action" varchar(50),
	"signature_valid" boolean NOT NULL,
	"headers" json,
	"payload" json NOT NULL,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"error_message" text,
	"retry_count" integer DEFAULT 0 NOT NULL,
	"next_retry_at" timestamp with time zone,
	"processed_at" timestamp with time zone,
	"received_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "forge_builds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"revision_id" uuid NOT NULL,
	"repo_id" uuid NOT NULL,
	"status" varchar(20) DEFAULT 'queued' NOT NULL,
	"idempotency_key" text NOT NULL,
	"ci_provider" text,
	"external_job_id" text,
	"image_digest" text,
	"artifact_manifest_ref" text,
	"duration_ms" integer,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "forge_deployments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"revision_id" uuid NOT NULL,
	"build_id" uuid NOT NULL,
	"repo_id" uuid NOT NULL,
	"environment" varchar(20) NOT NULL,
	"status" varchar(30) DEFAULT 'pending_approval' NOT NULL,
	"rollback_target_id" uuid,
	"deployed_at" timestamp with time zone,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "forge_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"repo_id" uuid NOT NULL,
	"rev_id" text NOT NULL,
	"task_id" uuid,
	"task_run_id" uuid,
	"branch" text,
	"status" varchar(20) DEFAULT 'open' NOT NULL,
	"gates" json DEFAULT '[]'::json,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "forge_run_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" text NOT NULL,
	"repo_id" uuid NOT NULL,
	"revision_id" uuid NOT NULL,
	"task_id" uuid,
	"agent_id" uuid,
	"event_type" varchar(30) NOT NULL,
	"test_status" text,
	"artifact_refs" json DEFAULT '[]'::json,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "activities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"work_item_id" uuid NOT NULL,
	"user_id" text,
	"type" "work_item_activity_type" NOT NULL,
	"from_value" text,
	"to_value" text,
	"metadata" json,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "device_push_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"device_type" varchar(20) NOT NULL,
	"expo_push_token" text NOT NULL,
	"device_name" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"last_seen_at" timestamp with time zone,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "event_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"worktree_id" uuid,
	"repository_id" uuid,
	"event_type" varchar(50) NOT NULL,
	"payload" json DEFAULT '{}'::json NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
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
--> statement-breakpoint
CREATE TABLE "browser_cookies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"domain" text NOT NULL,
	"name" text NOT NULL,
	"value_ciphertext" text NOT NULL,
	"value_iv" text NOT NULL,
	"value_tag" text NOT NULL,
	"path" text DEFAULT '/' NOT NULL,
	"expires" timestamp with time zone,
	"secure" boolean DEFAULT false NOT NULL,
	"http_only" boolean DEFAULT false NOT NULL,
	"same_site" varchar(10) DEFAULT 'Lax' NOT NULL,
	"source" varchar(20) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "session_cookie_scopes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"domain" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_deploy_secret_bindings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"environment" varchar(20) NOT NULL,
	"label" varchar(128) NOT NULL,
	"forgegraph_key" varchar(128) NOT NULL,
	"external_ref" text NOT NULL,
	"transport" varchar(32) DEFAULT 'template' NOT NULL,
	"template_id" varchar(64),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "session_secret_usages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"secret_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"executor" varchar(32) NOT NULL,
	"template_id" varchar(64),
	"command_preview" text,
	"exit_code" integer,
	"duration_ms" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session_secrets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"session_id" uuid NOT NULL,
	"workspace_id" uuid,
	"project_id" uuid,
	"label" varchar(128) NOT NULL,
	"handle" varchar(64) NOT NULL,
	"transport" varchar(32) DEFAULT 'template' NOT NULL,
	"source" varchar(32) DEFAULT 'pasted' NOT NULL,
	"provider" varchar(32) DEFAULT 'bob' NOT NULL,
	"status" varchar(20) DEFAULT 'active' NOT NULL,
	"value_ciphertext" text,
	"value_iv" text,
	"value_tag" text,
	"policy" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"external_ref" text,
	"expires_at" timestamp with time zone,
	"last_used_at" timestamp with time zone,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_codes" ADD CONSTRAINT "device_codes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_members" ADD CONSTRAINT "tenant_members_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_members" ADD CONSTRAINT "workspace_members_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_members" ADD CONSTRAINT "workspace_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspaces" ADD CONSTRAINT "workspaces_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspaces" ADD CONSTRAINT "workspaces_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_preferences" ADD CONSTRAINT "user_preferences_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discovered_dirs" ADD CONSTRAINT "discovered_dirs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_lead_user_id_users_id_fk" FOREIGN KEY ("lead_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repositories" ADD CONSTRAINT "repositories_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repositories" ADD CONSTRAINT "repositories_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_integrations" ADD CONSTRAINT "workspace_integrations_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "worktree_links" ADD CONSTRAINT "worktree_links_worktree_id_worktrees_id_fk" FOREIGN KEY ("worktree_id") REFERENCES "public"."worktrees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "worktree_links" ADD CONSTRAINT "worktree_links_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "worktree_plans" ADD CONSTRAINT "worktree_plans_worktree_id_worktrees_id_fk" FOREIGN KEY ("worktree_id") REFERENCES "public"."worktrees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "worktree_plans" ADD CONSTRAINT "worktree_plans_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "worktrees" ADD CONSTRAINT "worktrees_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "worktrees" ADD CONSTRAINT "worktrees_repository_id_repositories_id_fk" FOREIGN KEY ("repository_id") REFERENCES "public"."repositories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_work_item_id_work_items_id_fk" FOREIGN KEY ("work_item_id") REFERENCES "public"."work_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dispatch_batches" ADD CONSTRAINT "dispatch_batches_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dispatch_items" ADD CONSTRAINT "dispatch_items_batch_id_dispatch_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."dispatch_batches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dispatch_items" ADD CONSTRAINT "dispatch_items_task_run_id_task_runs_id_fk" FOREIGN KEY ("task_run_id") REFERENCES "public"."task_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_draft_dependencies" ADD CONSTRAINT "plan_draft_dependencies_draft_id_plan_drafts_id_fk" FOREIGN KEY ("draft_id") REFERENCES "public"."plan_drafts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_draft_dependencies" ADD CONSTRAINT "plan_draft_dependencies_depends_on_draft_id_plan_drafts_id_fk" FOREIGN KEY ("depends_on_draft_id") REFERENCES "public"."plan_drafts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_task_items" ADD CONSTRAINT "plan_task_items_plan_id_worktree_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."worktree_plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requirements" ADD CONSTRAINT "requirements_work_item_id_work_items_id_fk" FOREIGN KEY ("work_item_id") REFERENCES "public"."work_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_runs" ADD CONSTRAINT "task_runs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_runs" ADD CONSTRAINT "task_runs_work_item_id_work_items_id_fk" FOREIGN KEY ("work_item_id") REFERENCES "public"."work_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_runs" ADD CONSTRAINT "task_runs_repository_id_repositories_id_fk" FOREIGN KEY ("repository_id") REFERENCES "public"."repositories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_runs" ADD CONSTRAINT "task_runs_worktree_id_worktrees_id_fk" FOREIGN KEY ("worktree_id") REFERENCES "public"."worktrees"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_runs" ADD CONSTRAINT "task_runs_pull_request_id_pull_requests_id_fk" FOREIGN KEY ("pull_request_id") REFERENCES "public"."pull_requests"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_runs" ADD CONSTRAINT "task_runs_parent_task_run_id_task_runs_id_fk" FOREIGN KEY ("parent_task_run_id") REFERENCES "public"."task_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_item_artifacts" ADD CONSTRAINT "work_item_artifacts_work_item_id_work_items_id_fk" FOREIGN KEY ("work_item_id") REFERENCES "public"."work_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_item_artifacts" ADD CONSTRAINT "work_item_artifacts_task_run_id_task_runs_id_fk" FOREIGN KEY ("task_run_id") REFERENCES "public"."task_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_item_dependencies" ADD CONSTRAINT "work_item_dependencies_work_item_id_work_items_id_fk" FOREIGN KEY ("work_item_id") REFERENCES "public"."work_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_item_dependencies" ADD CONSTRAINT "work_item_dependencies_depends_on_work_item_id_work_items_id_fk" FOREIGN KEY ("depends_on_work_item_id") REFERENCES "public"."work_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_item_snapshots" ADD CONSTRAINT "work_item_snapshots_work_item_id_work_items_id_fk" FOREIGN KEY ("work_item_id") REFERENCES "public"."work_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_items" ADD CONSTRAINT "work_items_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_instances" ADD CONSTRAINT "agent_instances_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_instances" ADD CONSTRAINT "agent_instances_repository_id_repositories_id_fk" FOREIGN KEY ("repository_id") REFERENCES "public"."repositories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_instances" ADD CONSTRAINT "agent_instances_worktree_id_worktrees_id_fk" FOREIGN KEY ("worktree_id") REFERENCES "public"."worktrees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "instance_usage_summary" ADD CONSTRAINT "instance_usage_summary_instance_id_agent_instances_id_fk" FOREIGN KEY ("instance_id") REFERENCES "public"."agent_instances"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "instance_usage_summary" ADD CONSTRAINT "instance_usage_summary_worktree_id_worktrees_id_fk" FOREIGN KEY ("worktree_id") REFERENCES "public"."worktrees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "instance_usage_summary" ADD CONSTRAINT "instance_usage_summary_repository_id_repositories_id_fk" FOREIGN KEY ("repository_id") REFERENCES "public"."repositories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_artifacts" ADD CONSTRAINT "run_artifacts_run_id_agent_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."agent_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_lifecycle_events" ADD CONSTRAINT "run_lifecycle_events_task_run_id_task_runs_id_fk" FOREIGN KEY ("task_run_id") REFERENCES "public"."task_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_lifecycle_events" ADD CONSTRAINT "run_lifecycle_events_work_item_id_work_items_id_fk" FOREIGN KEY ("work_item_id") REFERENCES "public"."work_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_lifecycle_events" ADD CONSTRAINT "run_lifecycle_events_session_id_chat_conversations_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."chat_conversations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_checkpoints" ADD CONSTRAINT "session_checkpoints_session_id_chat_conversations_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."chat_conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_connections" ADD CONSTRAINT "session_connections_session_id_chat_conversations_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."chat_conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_connections" ADD CONSTRAINT "session_connections_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_events" ADD CONSTRAINT "session_events_session_id_chat_conversations_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."chat_conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_executions" ADD CONSTRAINT "skill_executions_session_id_chat_conversations_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."chat_conversations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_executions" ADD CONSTRAINT "skill_executions_skill_id_skills_id_fk" FOREIGN KEY ("skill_id") REFERENCES "public"."skills"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_executions" ADD CONSTRAINT "skill_executions_work_item_id_work_items_id_fk" FOREIGN KEY ("work_item_id") REFERENCES "public"."work_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "token_usage_sessions" ADD CONSTRAINT "token_usage_sessions_instance_id_agent_instances_id_fk" FOREIGN KEY ("instance_id") REFERENCES "public"."agent_instances"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "token_usage_sessions" ADD CONSTRAINT "token_usage_sessions_worktree_id_worktrees_id_fk" FOREIGN KEY ("worktree_id") REFERENCES "public"."worktrees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "token_usage_sessions" ADD CONSTRAINT "token_usage_sessions_repository_id_repositories_id_fk" FOREIGN KEY ("repository_id") REFERENCES "public"."repositories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_attachments" ADD CONSTRAINT "chat_attachments_message_id_chat_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."chat_messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_conversations" ADD CONSTRAINT "chat_conversations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_conversations" ADD CONSTRAINT "chat_conversations_repository_id_repositories_id_fk" FOREIGN KEY ("repository_id") REFERENCES "public"."repositories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_conversations" ADD CONSTRAINT "chat_conversations_worktree_id_worktrees_id_fk" FOREIGN KEY ("worktree_id") REFERENCES "public"."worktrees"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_conversations" ADD CONSTRAINT "chat_conversations_agent_instance_id_agent_instances_id_fk" FOREIGN KEY ("agent_instance_id") REFERENCES "public"."agent_instances"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_conversations" ADD CONSTRAINT "chat_conversations_work_item_id_work_items_id_fk" FOREIGN KEY ("work_item_id") REFERENCES "public"."work_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_conversation_id_chat_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."chat_conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feature_branch_task_prs" ADD CONSTRAINT "feature_branch_task_prs_feature_branch_id_feature_branches_id_fk" FOREIGN KEY ("feature_branch_id") REFERENCES "public"."feature_branches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feature_branch_task_prs" ADD CONSTRAINT "feature_branch_task_prs_pull_request_id_pull_requests_id_fk" FOREIGN KEY ("pull_request_id") REFERENCES "public"."pull_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feature_branches" ADD CONSTRAINT "feature_branches_work_item_id_work_items_id_fk" FOREIGN KEY ("work_item_id") REFERENCES "public"."work_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feature_branches" ADD CONSTRAINT "feature_branches_repository_id_repositories_id_fk" FOREIGN KEY ("repository_id") REFERENCES "public"."repositories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feature_branches" ADD CONSTRAINT "feature_branches_feature_pr_id_pull_requests_id_fk" FOREIGN KEY ("feature_pr_id") REFERENCES "public"."pull_requests"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "git_commits" ADD CONSTRAINT "git_commits_repository_id_repositories_id_fk" FOREIGN KEY ("repository_id") REFERENCES "public"."repositories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "git_commits" ADD CONSTRAINT "git_commits_pull_request_id_pull_requests_id_fk" FOREIGN KEY ("pull_request_id") REFERENCES "public"."pull_requests"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "git_commits" ADD CONSTRAINT "git_commits_session_id_chat_conversations_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."chat_conversations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "git_provider_connections" ADD CONSTRAINT "git_provider_connections_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pr_reviews" ADD CONSTRAINT "pr_reviews_pull_request_id_pull_requests_id_fk" FOREIGN KEY ("pull_request_id") REFERENCES "public"."pull_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pull_requests" ADD CONSTRAINT "pull_requests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pull_requests" ADD CONSTRAINT "pull_requests_repository_id_repositories_id_fk" FOREIGN KEY ("repository_id") REFERENCES "public"."repositories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pull_requests" ADD CONSTRAINT "pull_requests_git_provider_connection_id_git_provider_connections_id_fk" FOREIGN KEY ("git_provider_connection_id") REFERENCES "public"."git_provider_connections"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pull_requests" ADD CONSTRAINT "pull_requests_session_id_chat_conversations_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."chat_conversations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_configs" ADD CONSTRAINT "webhook_configs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_configs" ADD CONSTRAINT "webhook_configs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_webhook_config_id_webhook_configs_id_fk" FOREIGN KEY ("webhook_config_id") REFERENCES "public"."webhook_configs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forge_builds" ADD CONSTRAINT "forge_builds_revision_id_forge_revisions_id_fk" FOREIGN KEY ("revision_id") REFERENCES "public"."forge_revisions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forge_builds" ADD CONSTRAINT "forge_builds_repo_id_repositories_id_fk" FOREIGN KEY ("repo_id") REFERENCES "public"."repositories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forge_deployments" ADD CONSTRAINT "forge_deployments_revision_id_forge_revisions_id_fk" FOREIGN KEY ("revision_id") REFERENCES "public"."forge_revisions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forge_deployments" ADD CONSTRAINT "forge_deployments_build_id_forge_builds_id_fk" FOREIGN KEY ("build_id") REFERENCES "public"."forge_builds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forge_deployments" ADD CONSTRAINT "forge_deployments_repo_id_repositories_id_fk" FOREIGN KEY ("repo_id") REFERENCES "public"."repositories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forge_revisions" ADD CONSTRAINT "forge_revisions_repo_id_repositories_id_fk" FOREIGN KEY ("repo_id") REFERENCES "public"."repositories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forge_revisions" ADD CONSTRAINT "forge_revisions_task_id_work_items_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."work_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forge_revisions" ADD CONSTRAINT "forge_revisions_task_run_id_task_runs_id_fk" FOREIGN KEY ("task_run_id") REFERENCES "public"."task_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forge_run_events" ADD CONSTRAINT "forge_run_events_repo_id_repositories_id_fk" FOREIGN KEY ("repo_id") REFERENCES "public"."repositories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forge_run_events" ADD CONSTRAINT "forge_run_events_revision_id_forge_revisions_id_fk" FOREIGN KEY ("revision_id") REFERENCES "public"."forge_revisions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forge_run_events" ADD CONSTRAINT "forge_run_events_task_id_work_items_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."work_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activities" ADD CONSTRAINT "activities_work_item_id_work_items_id_fk" FOREIGN KEY ("work_item_id") REFERENCES "public"."work_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activities" ADD CONSTRAINT "activities_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_push_tokens" ADD CONSTRAINT "device_push_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_log" ADD CONSTRAINT "event_log_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_log" ADD CONSTRAINT "event_log_worktree_id_worktrees_id_fk" FOREIGN KEY ("worktree_id") REFERENCES "public"."worktrees"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_log" ADD CONSTRAINT "event_log_repository_id_repositories_id_fk" FOREIGN KEY ("repository_id") REFERENCES "public"."repositories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_work_item_id_work_items_id_fk" FOREIGN KEY ("work_item_id") REFERENCES "public"."work_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "browser_cookies" ADD CONSTRAINT "browser_cookies_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_cookie_scopes" ADD CONSTRAINT "session_cookie_scopes_session_id_chat_conversations_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."chat_conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_deploy_secret_bindings" ADD CONSTRAINT "project_deploy_secret_bindings_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_secret_usages" ADD CONSTRAINT "session_secret_usages_secret_id_session_secrets_id_fk" FOREIGN KEY ("secret_id") REFERENCES "public"."session_secrets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_secret_usages" ADD CONSTRAINT "session_secret_usages_session_id_chat_conversations_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."chat_conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_secrets" ADD CONSTRAINT "session_secrets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_secrets" ADD CONSTRAINT "session_secrets_session_id_chat_conversations_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."chat_conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_secrets" ADD CONSTRAINT "session_secrets_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_secrets" ADD CONSTRAINT "session_secrets_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "accounts_user_id_idx" ON "accounts" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "sessions_user_id_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "verifications_identifier_idx" ON "verifications" USING btree ("identifier");--> statement-breakpoint
CREATE UNIQUE INDEX "tenant_members_tenant_user_idx" ON "tenant_members" USING btree ("tenant_id","user_id");--> statement-breakpoint
CREATE INDEX "requirements_work_item_id_idx" ON "requirements" USING btree ("work_item_id");--> statement-breakpoint
CREATE INDEX "work_item_snapshots_work_item_id_idx" ON "work_item_snapshots" USING btree ("work_item_id");--> statement-breakpoint
CREATE INDEX "agent_runs_workspace_idx" ON "agent_runs" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "agent_runs_tenant_idx" ON "agent_runs" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "agent_runs_work_item_idx" ON "agent_runs" USING btree ("work_item_id");--> statement-breakpoint
CREATE INDEX "run_artifacts_run_idx" ON "run_artifacts" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "session_checkpoints_session_id_idx" ON "session_checkpoints" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "skill_executions_skill_slug_idx" ON "skill_executions" USING btree ("skill_slug");--> statement-breakpoint
CREATE INDEX "skill_executions_session_id_idx" ON "skill_executions" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "skill_executions_work_item_id_idx" ON "skill_executions" USING btree ("work_item_id");--> statement-breakpoint
CREATE INDEX "skill_executions_parent_execution_id_idx" ON "skill_executions" USING btree ("parent_execution_id");--> statement-breakpoint
CREATE INDEX "chat_attachments_message_id_idx" ON "chat_attachments" USING btree ("message_id");--> statement-breakpoint
CREATE INDEX "feature_branch_task_prs_feature_branch_id_idx" ON "feature_branch_task_prs" USING btree ("feature_branch_id");--> statement-breakpoint
CREATE INDEX "feature_branch_task_prs_pull_request_id_idx" ON "feature_branch_task_prs" USING btree ("pull_request_id");--> statement-breakpoint
CREATE INDEX "feature_branches_work_item_id_idx" ON "feature_branches" USING btree ("work_item_id");--> statement-breakpoint
CREATE INDEX "feature_branches_repository_id_idx" ON "feature_branches" USING btree ("repository_id");--> statement-breakpoint
CREATE INDEX "pr_reviews_pull_request_id_idx" ON "pr_reviews" USING btree ("pull_request_id");--> statement-breakpoint
CREATE INDEX "webhook_configs_user_id_idx" ON "webhook_configs" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "webhook_configs_workspace_id_idx" ON "webhook_configs" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "webhook_deliveries_config_id_idx" ON "webhook_deliveries" USING btree ("webhook_config_id");--> statement-breakpoint
CREATE UNIQUE INDEX "browser_cookies_user_domain_name_path_idx" ON "browser_cookies" USING btree ("user_id","domain","name","path");--> statement-breakpoint
CREATE INDEX "browser_cookies_user_domain_idx" ON "browser_cookies" USING btree ("user_id","domain");--> statement-breakpoint
CREATE UNIQUE INDEX "session_cookie_scopes_session_domain_idx" ON "session_cookie_scopes" USING btree ("session_id","domain");--> statement-breakpoint
CREATE UNIQUE INDEX "project_deploy_secret_bindings_env_key_idx" ON "project_deploy_secret_bindings" USING btree ("project_id","environment","forgegraph_key");--> statement-breakpoint
CREATE INDEX "session_secret_usages_secret_idx" ON "session_secret_usages" USING btree ("secret_id");--> statement-breakpoint
CREATE INDEX "session_secret_usages_session_idx" ON "session_secret_usages" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "session_secrets_session_idx" ON "session_secrets" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "session_secrets_project_idx" ON "session_secrets" USING btree ("project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "session_secrets_session_handle_idx" ON "session_secrets" USING btree ("session_id","handle");