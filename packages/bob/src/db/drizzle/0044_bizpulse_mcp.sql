CREATE TABLE "bizpulse_mcp_link" (
  "id" text PRIMARY KEY,
  "user_id" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "workspace_id" uuid NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "origin" text NOT NULL,
  "envelope" jsonb NOT NULL,
  "expires_at" timestamptz NOT NULL
);
--> statement-breakpoint
CREATE INDEX "bizpulse_mcp_link_owner_idx" ON "bizpulse_mcp_link" ("user_id", "workspace_id");
--> statement-breakpoint
CREATE TABLE "bizpulse_mcp_consent" (
  "state_hash" text PRIMARY KEY,
  "user_id" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "workspace_id" uuid NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "origin" text NOT NULL,
  "envelope" jsonb NOT NULL,
  "expires_at" timestamptz NOT NULL
);
--> statement-breakpoint
CREATE INDEX "bizpulse_mcp_consent_expiry_idx" ON "bizpulse_mcp_consent" ("expires_at");
