-- Add 'active' to project_status enum
ALTER TYPE project_status ADD VALUE IF NOT EXISTS 'active';

-- Add ForgeGraph integration columns to projects table
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "forge_graph_app_id" text UNIQUE;
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "repo_url" text;
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "default_branch" text;
