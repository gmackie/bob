CREATE EXTENSION IF NOT EXISTS vector;
--> statement-breakpoint
CREATE SCHEMA "ooda";
--> statement-breakpoint
CREATE TYPE "ooda"."conversation_status" AS ENUM('active', 'archived');--> statement-breakpoint
CREATE TYPE "ooda"."sensitivity" AS ENUM('general', 'personal', 'sensitive', 'restricted');--> statement-breakpoint
CREATE TYPE "ooda"."tts_policy" AS ENUM('allowed', 'manual', 'disabled', 'sensitive_denied');--> statement-breakpoint
CREATE TYPE "ooda"."memory_edge_kind" AS ENUM('semantic', 'entity', 'temporal', 'causal', 'supports', 'conflicts', 'supersedes', 'external');--> statement-breakpoint
CREATE TYPE "ooda"."memory_feedback_state" AS ENUM('unreviewed', 'confirmed', 'suppressed');--> statement-breakpoint
CREATE TYPE "ooda"."memory_lifecycle_state" AS ENUM('captured', 'enriched', 'incubating', 'proposed', 'committed', 'completed', 'reflected', 'dismissed', 'merged', 'killed');--> statement-breakpoint
CREATE TYPE "ooda"."memory_seed_kind" AS ENUM('question', 'idea', 'observation', 'preference', 'claim', 'decision', 'commitment', 'correction');--> statement-breakpoint
CREATE TABLE "ooda"."conversation_branches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"parent_branch_id" uuid,
	"fork_event_id" uuid,
	"name" varchar(256) NOT NULL,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ooda"."conversation_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"sequence" bigint NOT NULL,
	"type" varchar(64) NOT NULL,
	"actor_type" varchar(32) NOT NULL,
	"actor_id" text,
	"payload" jsonb NOT NULL,
	"sensitivity" "ooda"."sensitivity" DEFAULT 'general' NOT NULL,
	"correlation_id" text NOT NULL,
	"causation_id" text,
	"idempotency_key" text,
	"occurred_at" timestamp with time zone NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ooda"."conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" text NOT NULL,
	"title" varchar(256) NOT NULL,
	"status" "ooda"."conversation_status" DEFAULT 'active' NOT NULL,
	"host_provider" varchar(64) DEFAULT 'grok' NOT NULL,
	"host_profile" varchar(128) DEFAULT 'daily' NOT NULL,
	"active_branch_id" uuid,
	"last_sequence" bigint DEFAULT 0 NOT NULL,
	"sensitivity_ceiling" "ooda"."sensitivity" DEFAULT 'personal' NOT NULL,
	"tts_policy" "ooda"."tts_policy" DEFAULT 'allowed' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ooda"."attention_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"memory_seed_id" uuid NOT NULL,
	"dimension_scores" jsonb NOT NULL,
	"uncertainty" real NOT NULL,
	"recommendation" varchar(32) NOT NULL,
	"capacity_snapshot" jsonb NOT NULL,
	"proposal_id" uuid,
	"dismissal_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ooda"."memory_edges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"from_memory_id" uuid NOT NULL,
	"to_memory_id" uuid NOT NULL,
	"kind" "ooda"."memory_edge_kind" NOT NULL,
	"score" real NOT NULL,
	"explanation" text NOT NULL,
	"discovery_method" varchar(128) NOT NULL,
	"feedback_state" "ooda"."memory_feedback_state" DEFAULT 'unreviewed' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ooda"."memory_seeds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"kind" "ooda"."memory_seed_kind" NOT NULL,
	"source_event_id" uuid NOT NULL,
	"source_span_start" integer NOT NULL,
	"source_span_end" integer NOT NULL,
	"normalized_text" text NOT NULL,
	"embedding" vector(1536),
	"embedding_model" text,
	"entities" text[] DEFAULT '{}' NOT NULL,
	"sensitivity" "ooda"."sensitivity" DEFAULT 'general' NOT NULL,
	"confidence" real NOT NULL,
	"lifecycle_state" "ooda"."memory_lifecycle_state" DEFAULT 'captured' NOT NULL,
	"superseded_by_id" uuid,
	"migration_metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ooda"."agent_job_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_job_id" uuid NOT NULL,
	"sequence" bigint NOT NULL,
	"type" varchar(64) NOT NULL,
	"payload" jsonb NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ooda"."agent_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"class" varchar(64) NOT NULL,
	"status" varchar(32) DEFAULT 'queued' NOT NULL,
	"provider" varchar(64) NOT NULL,
	"capabilities" text[] DEFAULT '{}' NOT NULL,
	"deadline_seconds" integer NOT NULL,
	"aggregate_token_budget" integer NOT NULL,
	"context_pack_id" uuid,
	"correlation_id" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"sandbox_ref" text,
	"error" text,
	"result" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"expires_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "ooda"."approval_decisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"proposal_id" uuid NOT NULL,
	"decision" varchar(16) NOT NULL,
	"expected_version" integer NOT NULL,
	"scope" varchar(32) DEFAULT 'single_delivery' NOT NULL,
	"rationale" text,
	"decided_by" text NOT NULL,
	"decided_at" timestamp with time zone NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ooda"."context_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"context_pack_id" uuid NOT NULL,
	"source_type" varchar(64) NOT NULL,
	"source_id" text NOT NULL,
	"sensitivity" "ooda"."sensitivity" NOT NULL,
	"decision" varchar(32) NOT NULL,
	"reason" text NOT NULL,
	"content" text,
	"redaction" text,
	"ordinal" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ooda"."context_packs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"provider" varchar(64) NOT NULL,
	"purpose" varchar(64) NOT NULL,
	"policy_snapshot" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "ooda"."proposals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"kind" varchar(64) NOT NULL,
	"destination" varchar(128) NOT NULL,
	"status" varchar(32) DEFAULT 'draft' NOT NULL,
	"risk" varchar(32) NOT NULL,
	"preview" jsonb NOT NULL,
	"rationale" text NOT NULL,
	"confidence" real NOT NULL,
	"policy_snapshot" jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ooda"."dead_letters" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"outbox_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"repaired_at" timestamp with time zone,
	"repaired_by" text,
	"repair_note" text
);
--> statement-breakpoint
CREATE TABLE "ooda"."delivery_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"outbox_id" uuid NOT NULL,
	"attempt" integer NOT NULL,
	"status" varchar(32) NOT NULL,
	"error" text,
	"receipt" jsonb,
	"started_at" timestamp with time zone NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "ooda"."external_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid,
	"proposal_id" uuid,
	"destination" varchar(128) NOT NULL,
	"external_type" varchar(128) NOT NULL,
	"external_id" text NOT NULL,
	"deep_link" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"status" varchar(32) DEFAULT 'active' NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ooda"."integration_outbox" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"proposal_id" uuid NOT NULL,
	"destination" varchar(128) NOT NULL,
	"idempotency_key" text NOT NULL,
	"payload" jsonb NOT NULL,
	"status" varchar(32) DEFAULT 'pending' NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"claimed_at" timestamp with time zone,
	"claimed_by" text,
	"delivered_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ooda"."conversation_branches" ADD CONSTRAINT "conversation_branches_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "ooda"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ooda"."conversation_branches" ADD CONSTRAINT "conversation_branches_parent_branch_id_conversation_branches_id_fk" FOREIGN KEY ("parent_branch_id") REFERENCES "ooda"."conversation_branches"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ooda"."conversation_events" ADD CONSTRAINT "conversation_events_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "ooda"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ooda"."conversation_events" ADD CONSTRAINT "conversation_events_branch_id_conversation_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "ooda"."conversation_branches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ooda"."attention_reviews" ADD CONSTRAINT "attention_reviews_memory_seed_id_memory_seeds_id_fk" FOREIGN KEY ("memory_seed_id") REFERENCES "ooda"."memory_seeds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ooda"."memory_edges" ADD CONSTRAINT "memory_edges_from_memory_id_memory_seeds_id_fk" FOREIGN KEY ("from_memory_id") REFERENCES "ooda"."memory_seeds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ooda"."memory_edges" ADD CONSTRAINT "memory_edges_to_memory_id_memory_seeds_id_fk" FOREIGN KEY ("to_memory_id") REFERENCES "ooda"."memory_seeds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ooda"."memory_seeds" ADD CONSTRAINT "memory_seeds_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "ooda"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ooda"."memory_seeds" ADD CONSTRAINT "memory_seeds_source_event_id_conversation_events_id_fk" FOREIGN KEY ("source_event_id") REFERENCES "ooda"."conversation_events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ooda"."memory_seeds" ADD CONSTRAINT "memory_seeds_superseded_by_id_memory_seeds_id_fk" FOREIGN KEY ("superseded_by_id") REFERENCES "ooda"."memory_seeds"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ooda"."agent_job_events" ADD CONSTRAINT "agent_job_events_agent_job_id_agent_jobs_id_fk" FOREIGN KEY ("agent_job_id") REFERENCES "ooda"."agent_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ooda"."agent_jobs" ADD CONSTRAINT "agent_jobs_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "ooda"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ooda"."approval_decisions" ADD CONSTRAINT "approval_decisions_proposal_id_proposals_id_fk" FOREIGN KEY ("proposal_id") REFERENCES "ooda"."proposals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ooda"."context_items" ADD CONSTRAINT "context_items_context_pack_id_context_packs_id_fk" FOREIGN KEY ("context_pack_id") REFERENCES "ooda"."context_packs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ooda"."context_packs" ADD CONSTRAINT "context_packs_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "ooda"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ooda"."proposals" ADD CONSTRAINT "proposals_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "ooda"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ooda"."dead_letters" ADD CONSTRAINT "dead_letters_outbox_id_integration_outbox_id_fk" FOREIGN KEY ("outbox_id") REFERENCES "ooda"."integration_outbox"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ooda"."delivery_attempts" ADD CONSTRAINT "delivery_attempts_outbox_id_integration_outbox_id_fk" FOREIGN KEY ("outbox_id") REFERENCES "ooda"."integration_outbox"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ooda"."external_links" ADD CONSTRAINT "external_links_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "ooda"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ooda"."external_links" ADD CONSTRAINT "external_links_proposal_id_proposals_id_fk" FOREIGN KEY ("proposal_id") REFERENCES "ooda"."proposals"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ooda"."integration_outbox" ADD CONSTRAINT "integration_outbox_proposal_id_proposals_id_fk" FOREIGN KEY ("proposal_id") REFERENCES "ooda"."proposals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "conversation_branches_conversation_idx" ON "ooda"."conversation_branches" USING btree ("conversation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "conversation_branches_conversation_name_uidx" ON "ooda"."conversation_branches" USING btree ("conversation_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "conversation_events_conversation_sequence_uidx" ON "ooda"."conversation_events" USING btree ("conversation_id","sequence");--> statement-breakpoint
CREATE UNIQUE INDEX "conversation_events_conversation_idempotency_uidx" ON "ooda"."conversation_events" USING btree ("conversation_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "conversation_events_branch_sequence_idx" ON "ooda"."conversation_events" USING btree ("branch_id","sequence");--> statement-breakpoint
CREATE INDEX "conversation_events_correlation_idx" ON "ooda"."conversation_events" USING btree ("correlation_id");--> statement-breakpoint
CREATE INDEX "conversations_owner_updated_idx" ON "ooda"."conversations" USING btree ("owner_id","updated_at");--> statement-breakpoint
CREATE INDEX "conversations_owner_status_idx" ON "ooda"."conversations" USING btree ("owner_id","status");--> statement-breakpoint
CREATE INDEX "attention_reviews_memory_created_idx" ON "ooda"."attention_reviews" USING btree ("memory_seed_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "memory_edges_endpoints_kind_uidx" ON "ooda"."memory_edges" USING btree ("from_memory_id","to_memory_id","kind");--> statement-breakpoint
CREATE INDEX "memory_edges_to_idx" ON "ooda"."memory_edges" USING btree ("to_memory_id");--> statement-breakpoint
CREATE INDEX "memory_seeds_conversation_created_idx" ON "ooda"."memory_seeds" USING btree ("conversation_id","created_at");--> statement-breakpoint
CREATE INDEX "memory_seeds_lifecycle_updated_idx" ON "ooda"."memory_seeds" USING btree ("lifecycle_state","updated_at");--> statement-breakpoint
CREATE INDEX "memory_seeds_embedding_hnsw_idx" ON "ooda"."memory_seeds" USING hnsw ("embedding" vector_cosine_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "agent_job_events_job_sequence_uidx" ON "ooda"."agent_job_events" USING btree ("agent_job_id","sequence");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_jobs_conversation_idempotency_uidx" ON "ooda"."agent_jobs" USING btree ("conversation_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "agent_jobs_conversation_status_idx" ON "ooda"."agent_jobs" USING btree ("conversation_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "approval_decisions_proposal_version_uidx" ON "ooda"."approval_decisions" USING btree ("proposal_id","expected_version");--> statement-breakpoint
CREATE UNIQUE INDEX "context_items_pack_ordinal_uidx" ON "ooda"."context_items" USING btree ("context_pack_id","ordinal");--> statement-breakpoint
CREATE INDEX "context_packs_conversation_created_idx" ON "ooda"."context_packs" USING btree ("conversation_id","created_at");--> statement-breakpoint
CREATE INDEX "proposals_conversation_status_idx" ON "ooda"."proposals" USING btree ("conversation_id","status");--> statement-breakpoint
CREATE INDEX "proposals_destination_status_idx" ON "ooda"."proposals" USING btree ("destination","status");--> statement-breakpoint
CREATE UNIQUE INDEX "dead_letters_outbox_uidx" ON "ooda"."dead_letters" USING btree ("outbox_id");--> statement-breakpoint
CREATE INDEX "dead_letters_unrepaired_idx" ON "ooda"."dead_letters" USING btree ("repaired_at");--> statement-breakpoint
CREATE UNIQUE INDEX "delivery_attempts_outbox_attempt_uidx" ON "ooda"."delivery_attempts" USING btree ("outbox_id","attempt");--> statement-breakpoint
CREATE UNIQUE INDEX "external_links_destination_idempotency_uidx" ON "ooda"."external_links" USING btree ("destination","idempotency_key");--> statement-breakpoint
CREATE INDEX "external_links_conversation_idx" ON "ooda"."external_links" USING btree ("conversation_id");--> statement-breakpoint
CREATE INDEX "external_links_proposal_idx" ON "ooda"."external_links" USING btree ("proposal_id");--> statement-breakpoint
CREATE UNIQUE INDEX "integration_outbox_idempotency_uidx" ON "ooda"."integration_outbox" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "integration_outbox_status_available_idx" ON "ooda"."integration_outbox" USING btree ("status","available_at");
