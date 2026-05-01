CREATE TYPE "public"."session_status" AS ENUM('pending', 'running', 'completed', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."thread_status" AS ENUM('active', 'paused', 'archived', 'completed');--> statement-breakpoint
CREATE TABLE "provenance_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"artifact_id" text NOT NULL,
	"thread_id" uuid NOT NULL,
	"session_id" uuid,
	"capability_id" varchar(64) NOT NULL,
	"operation_id" varchar(64) NOT NULL,
	"source_type" varchar(32) NOT NULL,
	"query_or_input_ref" text NOT NULL,
	"canonical_source_ref" text,
	"unverified" boolean DEFAULT false,
	"retrieved_at" timestamp with time zone NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "research_thread" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" varchar(256) NOT NULL,
	"slug" varchar(128) NOT NULL,
	"domain_pack_id" varchar(64),
	"status" "thread_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone,
	CONSTRAINT "research_thread_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "runner_device" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(128) NOT NULL,
	"hostname" varchar(256),
	"status" varchar(32) DEFAULT 'online' NOT NULL,
	"last_heartbeat_at" timestamp with time zone,
	"capabilities" json DEFAULT '[]'::json NOT NULL,
	"registered_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "runner_session" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"thread_id" uuid NOT NULL,
	"runner_id" uuid NOT NULL,
	"adapter_id" varchar(64) NOT NULL,
	"tool_profile_id" varchar(64) NOT NULL,
	"status" "session_status" DEFAULT 'pending' NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"exit_code" integer,
	"comparison_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "provenance_event" ADD CONSTRAINT "provenance_event_thread_id_research_thread_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."research_thread"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provenance_event" ADD CONSTRAINT "provenance_event_session_id_runner_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."runner_session"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runner_session" ADD CONSTRAINT "runner_session_thread_id_research_thread_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."research_thread"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runner_session" ADD CONSTRAINT "runner_session_runner_id_runner_device_id_fk" FOREIGN KEY ("runner_id") REFERENCES "public"."runner_device"("id") ON DELETE cascade ON UPDATE no action;