-- Add discovery fields to workspaces
ALTER TABLE "workspaces" ADD COLUMN "forge_available" boolean DEFAULT false;
ALTER TABLE "workspaces" ADD COLUMN "forge_api_key" text;
ALTER TABLE "workspaces" ADD COLUMN "dev_dir" text;

-- Add discovery fields to repositories
ALTER TABLE "repositories" ADD COLUMN "workspace_id" uuid REFERENCES "workspaces"("id") ON DELETE CASCADE;
ALTER TABLE "repositories" ADD COLUMN "build_system" varchar(32);
ALTER TABLE "repositories" ADD COLUMN "dirty" boolean DEFAULT false;
ALTER TABLE "repositories" ADD COLUMN "stale" boolean DEFAULT false;
ALTER TABLE "repositories" ADD COLUMN "discovery_status" varchar(16) DEFAULT 'discovered';

-- Discovered non-git directories
CREATE TABLE "discovered_dirs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "workspace_id" uuid NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "path" text NOT NULL,
  "name" varchar(256) NOT NULL,
  "dismissed" boolean DEFAULT false,
  "last_seen" timestamp DEFAULT now(),
  "created_at" timestamp DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX "discovered_dirs_workspace_path_idx" ON "discovered_dirs" ("workspace_id", "path");
CREATE INDEX "repositories_workspace_id_idx" ON "repositories" ("workspace_id");
