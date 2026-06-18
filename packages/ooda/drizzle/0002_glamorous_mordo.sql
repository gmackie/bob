CREATE SCHEMA "personal_vault";
--> statement-breakpoint
CREATE SCHEMA "research_vault";
--> statement-breakpoint
CREATE TYPE "personal_vault"."source_kind" AS ENUM ('chat', 'youtube', 'x-bookmark', 'chat-import', 'file');
--> statement-breakpoint
CREATE TYPE "research_vault"."source_kind" AS ENUM ('chat', 'youtube', 'x-bookmark', 'chat-import', 'file');
--> statement-breakpoint
CREATE TABLE "personal_vault"."embeddings" (
	"source_id" integer NOT NULL,
	"model" text NOT NULL,
	"dim" integer NOT NULL,
	"vec" "bytea" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "embeddings_source_id_model_pk" PRIMARY KEY("source_id","model")
);
--> statement-breakpoint
CREATE TABLE "personal_vault"."import_jobs" (
	"id" serial PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"config" text,
	"schedule_cron" text,
	"last_run_at" timestamp with time zone,
	"last_cursor" text,
	"last_error" text
);
--> statement-breakpoint
CREATE TABLE "personal_vault"."kb_sources" (
	"kb_id" integer NOT NULL,
	"source_id" integer NOT NULL,
	"score" real NOT NULL,
	"reason" text,
	"assigned_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "kb_sources_kb_id_source_id_pk" PRIMARY KEY("kb_id","source_id")
);
--> statement-breakpoint
CREATE TABLE "personal_vault"."kbs" (
	"id" serial PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"config" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "kbs_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "personal_vault"."source_topics" (
	"source_id" integer NOT NULL,
	"topic_id" integer NOT NULL,
	"score" real NOT NULL,
	CONSTRAINT "source_topics_source_id_topic_id_pk" PRIMARY KEY("source_id","topic_id")
);
--> statement-breakpoint
CREATE TABLE "personal_vault"."sources" (
	"id" serial PRIMARY KEY NOT NULL,
	"kind" "personal_vault"."source_kind" NOT NULL,
	"external_id" text NOT NULL,
	"title" text,
	"body" text NOT NULL,
	"frontmatter" text,
	"url" text,
	"author" text,
	"source_ts" timestamp with time zone,
	"imported_at" timestamp with time zone DEFAULT now() NOT NULL,
	"content_hash" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "personal_vault"."topics" (
	"id" serial PRIMARY KEY NOT NULL,
	"label" text,
	"description" text,
	"centroid" "bytea",
	"source_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "research_vault"."embeddings" (
	"source_id" integer NOT NULL,
	"model" text NOT NULL,
	"dim" integer NOT NULL,
	"vec" "bytea" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "embeddings_source_id_model_pk" PRIMARY KEY("source_id","model")
);
--> statement-breakpoint
CREATE TABLE "research_vault"."import_jobs" (
	"id" serial PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"config" text,
	"schedule_cron" text,
	"last_run_at" timestamp with time zone,
	"last_cursor" text,
	"last_error" text
);
--> statement-breakpoint
CREATE TABLE "research_vault"."kb_sources" (
	"kb_id" integer NOT NULL,
	"source_id" integer NOT NULL,
	"score" real NOT NULL,
	"reason" text,
	"assigned_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "kb_sources_kb_id_source_id_pk" PRIMARY KEY("kb_id","source_id")
);
--> statement-breakpoint
CREATE TABLE "research_vault"."kbs" (
	"id" serial PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"config" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "kbs_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "research_vault"."source_topics" (
	"source_id" integer NOT NULL,
	"topic_id" integer NOT NULL,
	"score" real NOT NULL,
	CONSTRAINT "source_topics_source_id_topic_id_pk" PRIMARY KEY("source_id","topic_id")
);
--> statement-breakpoint
CREATE TABLE "research_vault"."sources" (
	"id" serial PRIMARY KEY NOT NULL,
	"kind" "research_vault"."source_kind" NOT NULL,
	"external_id" text NOT NULL,
	"title" text,
	"body" text NOT NULL,
	"frontmatter" text,
	"url" text,
	"author" text,
	"source_ts" timestamp with time zone,
	"imported_at" timestamp with time zone DEFAULT now() NOT NULL,
	"content_hash" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "research_vault"."topics" (
	"id" serial PRIMARY KEY NOT NULL,
	"label" text,
	"description" text,
	"centroid" "bytea",
	"source_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "personal_vault"."embeddings" ADD CONSTRAINT "embeddings_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "personal_vault"."sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "personal_vault"."kb_sources" ADD CONSTRAINT "kb_sources_kb_id_kbs_id_fk" FOREIGN KEY ("kb_id") REFERENCES "personal_vault"."kbs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "personal_vault"."kb_sources" ADD CONSTRAINT "kb_sources_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "personal_vault"."sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "personal_vault"."source_topics" ADD CONSTRAINT "source_topics_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "personal_vault"."sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "personal_vault"."source_topics" ADD CONSTRAINT "source_topics_topic_id_topics_id_fk" FOREIGN KEY ("topic_id") REFERENCES "personal_vault"."topics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_vault"."embeddings" ADD CONSTRAINT "embeddings_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "research_vault"."sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_vault"."kb_sources" ADD CONSTRAINT "kb_sources_kb_id_kbs_id_fk" FOREIGN KEY ("kb_id") REFERENCES "research_vault"."kbs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_vault"."kb_sources" ADD CONSTRAINT "kb_sources_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "research_vault"."sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_vault"."source_topics" ADD CONSTRAINT "source_topics_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "research_vault"."sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_vault"."source_topics" ADD CONSTRAINT "source_topics_topic_id_topics_id_fk" FOREIGN KEY ("topic_id") REFERENCES "research_vault"."topics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "kb_sources_kb_idx" ON "personal_vault"."kb_sources" USING btree ("kb_id");--> statement-breakpoint
CREATE INDEX "source_topics_topic_idx" ON "personal_vault"."source_topics" USING btree ("topic_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sources_kind_external_id_idx" ON "personal_vault"."sources" USING btree ("kind","external_id");--> statement-breakpoint
CREATE INDEX "sources_kind_idx" ON "personal_vault"."sources" USING btree ("kind");--> statement-breakpoint
CREATE INDEX "sources_hash_idx" ON "personal_vault"."sources" USING btree ("content_hash");--> statement-breakpoint
CREATE INDEX "kb_sources_kb_idx" ON "research_vault"."kb_sources" USING btree ("kb_id");--> statement-breakpoint
CREATE INDEX "source_topics_topic_idx" ON "research_vault"."source_topics" USING btree ("topic_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sources_kind_external_id_idx" ON "research_vault"."sources" USING btree ("kind","external_id");--> statement-breakpoint
CREATE INDEX "sources_kind_idx" ON "research_vault"."sources" USING btree ("kind");--> statement-breakpoint
CREATE INDEX "sources_hash_idx" ON "research_vault"."sources" USING btree ("content_hash");