CREATE TABLE "session_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"type" varchar(32) NOT NULL,
	"content" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "session_event" ADD CONSTRAINT "session_event_session_id_runner_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."runner_session"("id") ON DELETE cascade ON UPDATE no action;