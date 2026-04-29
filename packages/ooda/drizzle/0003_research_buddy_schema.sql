CREATE TYPE "public"."exploration_status" AS ENUM('queued', 'running', 'done', 'error');--> statement-breakpoint
CREATE TYPE "public"."thread_link_kind" AS ENUM('topic_overlap', 'citation_overlap', 'question_answered', 'supersedes');--> statement-breakpoint
CREATE TYPE "personal_vault"."findings_triage" AS ENUM('pending', 'saved', 'dismissed', 'promoted');--> statement-breakpoint
CREATE TYPE "personal_vault"."graph_edge_kind" AS ENUM('cites', 'references', 'similar_embedding', 'recommended_by_s2');--> statement-breakpoint
CREATE TYPE "research_vault"."findings_triage" AS ENUM('pending', 'saved', 'dismissed', 'promoted');--> statement-breakpoint
CREATE TYPE "research_vault"."graph_edge_kind" AS ENUM('cites', 'references', 'similar_embedding', 'recommended_by_s2');--> statement-breakpoint
CREATE TABLE "graph_exploration" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"thread_id" uuid NOT NULL,
	"seed" text[] NOT NULL,
	"budget_papers" integer DEFAULT 60 NOT NULL,
	"budget_seconds" integer DEFAULT 180 NOT NULL,
	"status" "exploration_status" DEFAULT 'queued' NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"summary_md" text,
	"meta" jsonb,
	"errors_json" jsonb,
	"error_md" text
);
--> statement-breakpoint
CREATE TABLE "thread_link" (
	"from_thread_id" uuid NOT NULL,
	"to_thread_id" uuid NOT NULL,
	"kind" "thread_link_kind" NOT NULL,
	"score" real,
	"reason_md" text,
	"discovered_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "thread_link_from_thread_id_to_thread_id_kind_pk" PRIMARY KEY("from_thread_id","to_thread_id","kind")
);
--> statement-breakpoint
CREATE TABLE "thread_memory" (
	"thread_id" uuid PRIMARY KEY NOT NULL,
	"rolling_summary_md" text,
	"topic_fingerprint" text[],
	"embedding" "bytea",
	"turns_since_update" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tool_call_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"thread_id" uuid NOT NULL,
	"runner_session_id" uuid,
	"tool_name" text NOT NULL,
	"args" jsonb,
	"result_summary" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"error" text
);
--> statement-breakpoint
CREATE TABLE "personal_vault"."findings_inbox" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"standing_interest_id" uuid,
	"source_id" integer NOT NULL,
	"reason_md" text,
	"score" real,
	"found_at" timestamp with time zone DEFAULT now() NOT NULL,
	"triage" "personal_vault"."findings_triage" DEFAULT 'pending' NOT NULL,
	"triage_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "personal_vault"."graph_edge" (
	"from_source_id" integer NOT NULL,
	"to_source_id" integer NOT NULL,
	"kind" "personal_vault"."graph_edge_kind" NOT NULL,
	"weight" real,
	"discovered_in" uuid,
	CONSTRAINT "graph_edge_from_source_id_to_source_id_kind_pk" PRIMARY KEY("from_source_id","to_source_id","kind")
);
--> statement-breakpoint
CREATE TABLE "personal_vault"."graph_node" (
	"source_id" integer PRIMARY KEY NOT NULL,
	"s2_paper_id" text,
	"openalex_id" text,
	"doi" text,
	"influence_score" real,
	"first_seen_exploration" uuid,
	CONSTRAINT "graph_node_s2PaperId_unique" UNIQUE("s2_paper_id")
);
--> statement-breakpoint
CREATE TABLE "personal_vault"."s2_cache" (
	"key" text PRIMARY KEY NOT NULL,
	"response_json" jsonb NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "personal_vault"."standing_interest" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"thread_id" uuid,
	"label" text NOT NULL,
	"query_terms" text[] DEFAULT '{}'::text[] NOT NULL,
	"seed_source_ids" integer[] DEFAULT '{}'::integer[] NOT NULL,
	"cadence_seconds" integer DEFAULT 7200 NOT NULL,
	"last_run_at" timestamp with time zone,
	"last_cursor" text,
	"last_error" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"auto_disable_suggested" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "research_vault"."findings_inbox" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"standing_interest_id" uuid,
	"source_id" integer NOT NULL,
	"reason_md" text,
	"score" real,
	"found_at" timestamp with time zone DEFAULT now() NOT NULL,
	"triage" "research_vault"."findings_triage" DEFAULT 'pending' NOT NULL,
	"triage_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "research_vault"."graph_edge" (
	"from_source_id" integer NOT NULL,
	"to_source_id" integer NOT NULL,
	"kind" "research_vault"."graph_edge_kind" NOT NULL,
	"weight" real,
	"discovered_in" uuid,
	CONSTRAINT "graph_edge_from_source_id_to_source_id_kind_pk" PRIMARY KEY("from_source_id","to_source_id","kind")
);
--> statement-breakpoint
CREATE TABLE "research_vault"."graph_node" (
	"source_id" integer PRIMARY KEY NOT NULL,
	"s2_paper_id" text,
	"openalex_id" text,
	"doi" text,
	"influence_score" real,
	"first_seen_exploration" uuid,
	CONSTRAINT "graph_node_s2PaperId_unique" UNIQUE("s2_paper_id")
);
--> statement-breakpoint
CREATE TABLE "research_vault"."s2_cache" (
	"key" text PRIMARY KEY NOT NULL,
	"response_json" jsonb NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "research_vault"."standing_interest" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"thread_id" uuid,
	"label" text NOT NULL,
	"query_terms" text[] DEFAULT '{}'::text[] NOT NULL,
	"seed_source_ids" integer[] DEFAULT '{}'::integer[] NOT NULL,
	"cadence_seconds" integer DEFAULT 7200 NOT NULL,
	"last_run_at" timestamp with time zone,
	"last_cursor" text,
	"last_error" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"auto_disable_suggested" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
ALTER TABLE "graph_exploration" ADD CONSTRAINT "graph_exploration_thread_id_research_thread_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."research_thread"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "thread_link" ADD CONSTRAINT "thread_link_from_thread_id_research_thread_id_fk" FOREIGN KEY ("from_thread_id") REFERENCES "public"."research_thread"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "thread_link" ADD CONSTRAINT "thread_link_to_thread_id_research_thread_id_fk" FOREIGN KEY ("to_thread_id") REFERENCES "public"."research_thread"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "thread_memory" ADD CONSTRAINT "thread_memory_thread_id_research_thread_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."research_thread"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool_call_log" ADD CONSTRAINT "tool_call_log_thread_id_research_thread_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."research_thread"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool_call_log" ADD CONSTRAINT "tool_call_log_runner_session_id_runner_session_id_fk" FOREIGN KEY ("runner_session_id") REFERENCES "public"."runner_session"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "personal_vault"."findings_inbox" ADD CONSTRAINT "findings_inbox_standing_interest_id_standing_interest_id_fk" FOREIGN KEY ("standing_interest_id") REFERENCES "personal_vault"."standing_interest"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "personal_vault"."findings_inbox" ADD CONSTRAINT "findings_inbox_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "personal_vault"."sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "personal_vault"."graph_edge" ADD CONSTRAINT "graph_edge_from_source_id_sources_id_fk" FOREIGN KEY ("from_source_id") REFERENCES "personal_vault"."sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "personal_vault"."graph_edge" ADD CONSTRAINT "graph_edge_to_source_id_sources_id_fk" FOREIGN KEY ("to_source_id") REFERENCES "personal_vault"."sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "personal_vault"."graph_edge" ADD CONSTRAINT "graph_edge_discovered_in_graph_exploration_id_fk" FOREIGN KEY ("discovered_in") REFERENCES "public"."graph_exploration"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "personal_vault"."graph_node" ADD CONSTRAINT "graph_node_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "personal_vault"."sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "personal_vault"."graph_node" ADD CONSTRAINT "graph_node_first_seen_exploration_graph_exploration_id_fk" FOREIGN KEY ("first_seen_exploration") REFERENCES "public"."graph_exploration"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_vault"."findings_inbox" ADD CONSTRAINT "findings_inbox_standing_interest_id_standing_interest_id_fk" FOREIGN KEY ("standing_interest_id") REFERENCES "research_vault"."standing_interest"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_vault"."findings_inbox" ADD CONSTRAINT "findings_inbox_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "research_vault"."sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_vault"."graph_edge" ADD CONSTRAINT "graph_edge_from_source_id_sources_id_fk" FOREIGN KEY ("from_source_id") REFERENCES "research_vault"."sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_vault"."graph_edge" ADD CONSTRAINT "graph_edge_to_source_id_sources_id_fk" FOREIGN KEY ("to_source_id") REFERENCES "research_vault"."sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_vault"."graph_edge" ADD CONSTRAINT "graph_edge_discovered_in_graph_exploration_id_fk" FOREIGN KEY ("discovered_in") REFERENCES "public"."graph_exploration"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_vault"."graph_node" ADD CONSTRAINT "graph_node_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "research_vault"."sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_vault"."graph_node" ADD CONSTRAINT "graph_node_first_seen_exploration_graph_exploration_id_fk" FOREIGN KEY ("first_seen_exploration") REFERENCES "public"."graph_exploration"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "graph_exploration_status_started_idx" ON "graph_exploration" USING btree ("status","started_at");--> statement-breakpoint
CREATE INDEX "thread_link_to_idx" ON "thread_link" USING btree ("to_thread_id");--> statement-breakpoint
CREATE INDEX "tool_call_log_thread_started_idx" ON "tool_call_log" USING btree ("thread_id","started_at");--> statement-breakpoint
CREATE INDEX "findings_inbox_triage_found_idx" ON "personal_vault"."findings_inbox" USING btree ("triage","found_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "graph_edge_to_idx" ON "personal_vault"."graph_edge" USING btree ("to_source_id");--> statement-breakpoint
CREATE INDEX "s2_cache_expires_at_idx" ON "personal_vault"."s2_cache" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "standing_interest_enabled_last_run_idx" ON "personal_vault"."standing_interest" USING btree ("enabled","last_run_at");--> statement-breakpoint
CREATE INDEX "findings_inbox_triage_found_idx" ON "research_vault"."findings_inbox" USING btree ("triage","found_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "graph_edge_to_idx" ON "research_vault"."graph_edge" USING btree ("to_source_id");--> statement-breakpoint
CREATE INDEX "s2_cache_expires_at_idx" ON "research_vault"."s2_cache" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "standing_interest_enabled_last_run_idx" ON "research_vault"."standing_interest" USING btree ("enabled","last_run_at");