ALTER TABLE "ooda"."conversation_branches" ADD COLUMN "migration_metadata" jsonb;--> statement-breakpoint
ALTER TABLE "ooda"."conversations" ADD COLUMN "migration_metadata" jsonb;