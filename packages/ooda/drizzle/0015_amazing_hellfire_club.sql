ALTER TABLE "ooda"."memory_edges" ADD COLUMN "feedback_idempotency_key" text;--> statement-breakpoint
ALTER TABLE "ooda"."memory_edges" ADD COLUMN "feedback_fingerprint" text;--> statement-breakpoint
CREATE UNIQUE INDEX "memory_edges_feedback_idempotency_uidx" ON "ooda"."memory_edges" USING btree ("feedback_idempotency_key");