CREATE TABLE "ooda"."host_turn_executions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" text NOT NULL,
	"conversation_id" uuid NOT NULL,
	"user_event_id" uuid NOT NULL,
	"assistant_event_id" uuid,
	"idempotency_key" text NOT NULL,
	"command_fingerprint" text NOT NULL,
	"status" varchar(32) DEFAULT 'running' NOT NULL,
	"provider" varchar(32),
	"model" varchar(256),
	"provider_response_id" text,
	"fallback" jsonb,
	"error_code" varchar(128),
	"lease_expires_at" timestamp with time zone NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ooda"."host_turn_executions" ADD CONSTRAINT "host_turn_executions_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "ooda"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ooda"."host_turn_executions" ADD CONSTRAINT "host_turn_executions_user_event_id_conversation_events_id_fk" FOREIGN KEY ("user_event_id") REFERENCES "ooda"."conversation_events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ooda"."host_turn_executions" ADD CONSTRAINT "host_turn_executions_assistant_event_id_conversation_events_id_fk" FOREIGN KEY ("assistant_event_id") REFERENCES "ooda"."conversation_events"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "host_turn_executions_user_event_uidx" ON "ooda"."host_turn_executions" USING btree ("user_event_id");--> statement-breakpoint
CREATE UNIQUE INDEX "host_turn_executions_owner_idempotency_uidx" ON "ooda"."host_turn_executions" USING btree ("owner_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "host_turn_executions_status_lease_idx" ON "ooda"."host_turn_executions" USING btree ("status","lease_expires_at");--> statement-breakpoint
CREATE INDEX "host_turn_executions_conversation_idx" ON "ooda"."host_turn_executions" USING btree ("conversation_id");