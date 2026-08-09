ALTER TABLE "ooda"."external_links" ADD COLUMN "status_observed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "ooda"."external_links" ADD COLUMN "status_claimed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "ooda"."external_links" ADD COLUMN "status_claimed_by" text;--> statement-breakpoint
ALTER TABLE "ooda"."external_links" ADD COLUMN "status_error" text;--> statement-breakpoint
ALTER TABLE "ooda"."external_links" ADD COLUMN "next_status_check_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
CREATE INDEX "external_links_status_check_idx" ON "ooda"."external_links" USING btree ("status","next_status_check_at");