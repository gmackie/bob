ALTER TABLE "ooda"."conversation_branches" ADD COLUMN "idempotency_key" text;--> statement-breakpoint
ALTER TABLE "ooda"."conversation_branches" ADD COLUMN "command_fingerprint" text;--> statement-breakpoint
ALTER TABLE "ooda"."conversations" ADD COLUMN "creation_idempotency_key" text;--> statement-breakpoint
ALTER TABLE "ooda"."conversations" ADD COLUMN "creation_fingerprint" text;--> statement-breakpoint
CREATE UNIQUE INDEX "conversation_branches_conversation_idempotency_uidx" ON "ooda"."conversation_branches" USING btree ("conversation_id","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "conversations_owner_creation_idempotency_uidx" ON "ooda"."conversations" USING btree ("owner_id","creation_idempotency_key");