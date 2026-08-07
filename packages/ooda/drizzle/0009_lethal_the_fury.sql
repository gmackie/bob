CREATE TABLE "ooda"."tts_grants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" text NOT NULL,
	"conversation_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"request_mode" varchar(16) NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"idempotency_key" text NOT NULL,
	"command_fingerprint" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ooda"."tts_grants" ADD CONSTRAINT "tts_grants_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "ooda"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ooda"."tts_grants" ADD CONSTRAINT "tts_grants_event_id_conversation_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "ooda"."conversation_events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "tts_grants_token_hash_uidx" ON "ooda"."tts_grants" USING btree ("token_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "tts_grants_owner_idempotency_uidx" ON "ooda"."tts_grants" USING btree ("owner_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "tts_grants_expires_unused_idx" ON "ooda"."tts_grants" USING btree ("expires_at","used_at");--> statement-breakpoint
CREATE INDEX "tts_grants_conversation_event_idx" ON "ooda"."tts_grants" USING btree ("conversation_id","event_id");