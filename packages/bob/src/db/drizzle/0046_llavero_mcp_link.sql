CREATE TABLE "llavero_mcp_link" (
  "id" text PRIMARY KEY,
  "user_id" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "workspace_id" uuid NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "origin" text NOT NULL,
  "client_id" text NOT NULL,
  "state_hash" text UNIQUE,
  "verifier" jsonb,
  "consent_expires_at" timestamptz,
  "tokens" jsonb,
  "expires_at" timestamptz
);
--> statement-breakpoint
CREATE INDEX "llavero_mcp_link_owner_idx" ON "llavero_mcp_link" ("user_id", "workspace_id");
