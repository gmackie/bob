-- Add webhook_configs table
CREATE TABLE IF NOT EXISTS "webhook_configs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "workspace_id" uuid REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "url" text NOT NULL,
  "secret" text NOT NULL,
  "events" json NOT NULL DEFAULT '[]',
  "active" boolean NOT NULL DEFAULT true,
  "description" text,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone
);

CREATE INDEX IF NOT EXISTS "webhook_configs_user_id_idx" ON "webhook_configs" ("user_id");
CREATE INDEX IF NOT EXISTS "webhook_configs_workspace_id_idx" ON "webhook_configs" ("workspace_id");

-- Add webhook_config_id column to webhook_deliveries
ALTER TABLE "webhook_deliveries" ADD COLUMN IF NOT EXISTS "webhook_config_id" uuid REFERENCES "webhook_configs"("id") ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS "webhook_deliveries_config_id_idx" ON "webhook_deliveries" ("webhook_config_id");
