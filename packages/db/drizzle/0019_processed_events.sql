CREATE TABLE IF NOT EXISTS "processed_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "provider" varchar(20) NOT NULL,
  "event_id" text NOT NULL,
  "processed_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "processed_events_provider_event_id_idx"
  ON "processed_events" ("provider", "event_id");

CREATE INDEX IF NOT EXISTS "processed_events_provider_idx"
  ON "processed_events" ("provider");
