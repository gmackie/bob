CREATE TABLE IF NOT EXISTS "device_heartbeats" (
  "api_key_id" uuid PRIMARY KEY REFERENCES "api_keys"("id") ON DELETE CASCADE,
  "user_id" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "device_name" varchar(100) NOT NULL,
  "state" varchar(64) NOT NULL,
  "message" text,
  "wifi" text,
  "battery_percent" integer,
  "details" json NOT NULL DEFAULT '{}'::json,
  "last_seen_at" timestamp with time zone NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
