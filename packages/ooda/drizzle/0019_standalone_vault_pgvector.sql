CREATE TYPE "ooda"."migration_run_status" AS ENUM('pending', 'copying', 'embedding', 'verifying', 'completed', 'failed');--> statement-breakpoint
ALTER TYPE "personal_vault"."source_kind" ADD VALUE IF NOT EXISTS 'paper-s2';--> statement-breakpoint
ALTER TYPE "personal_vault"."source_kind" ADD VALUE IF NOT EXISTS 'paper-openalex';--> statement-breakpoint
ALTER TYPE "research_vault"."source_kind" ADD VALUE IF NOT EXISTS 'paper-s2';--> statement-breakpoint
ALTER TYPE "research_vault"."source_kind" ADD VALUE IF NOT EXISTS 'paper-openalex';--> statement-breakpoint
CREATE TABLE "personal_vault"."source_embedding" (
	"source_id" integer NOT NULL,
	"model" text NOT NULL,
	"embedding" vector(768) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "source_embedding_source_id_model_pk" PRIMARY KEY("source_id","model")
);
--> statement-breakpoint
CREATE TABLE "research_vault"."source_embedding" (
	"source_id" integer NOT NULL,
	"model" text NOT NULL,
	"embedding" vector(768) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "source_embedding_source_id_model_pk" PRIMARY KEY("source_id","model")
);
--> statement-breakpoint
CREATE TABLE "ooda"."migration_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"entity_type" varchar(64) NOT NULL,
	"source_id" text NOT NULL,
	"destination_table" varchar(128) NOT NULL,
	"destination_id" text NOT NULL,
	"content_hash" text,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ooda"."migration_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" text NOT NULL,
	"source" varchar(128) NOT NULL,
	"source_fingerprint" text NOT NULL,
	"status" "ooda"."migration_run_status" DEFAULT 'pending' NOT NULL,
	"phase" varchar(64) DEFAULT 'inventory' NOT NULL,
	"cursor" text,
	"source_counts" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"destination_counts" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"verification" jsonb,
	"last_error" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "personal_vault"."source_embedding" ADD CONSTRAINT "source_embedding_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "personal_vault"."sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_vault"."source_embedding" ADD CONSTRAINT "source_embedding_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "research_vault"."sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ooda"."migration_records" ADD CONSTRAINT "migration_records_run_id_migration_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "ooda"."migration_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "source_embedding_vec_hnsw_idx" ON "personal_vault"."source_embedding" USING hnsw ("embedding" vector_cosine_ops);--> statement-breakpoint
CREATE INDEX "source_embedding_vec_hnsw_idx" ON "research_vault"."source_embedding" USING hnsw ("embedding" vector_cosine_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "migration_records_source_entity_uidx" ON "ooda"."migration_records" USING btree ("run_id","entity_type","source_id");--> statement-breakpoint
CREATE INDEX "migration_records_destination_idx" ON "ooda"."migration_records" USING btree ("destination_table","destination_id");--> statement-breakpoint
CREATE UNIQUE INDEX "migration_runs_source_fingerprint_uidx" ON "ooda"."migration_runs" USING btree ("owner_id","source","source_fingerprint");--> statement-breakpoint
CREATE INDEX "migration_runs_status_updated_idx" ON "ooda"."migration_runs" USING btree ("status","updated_at");
