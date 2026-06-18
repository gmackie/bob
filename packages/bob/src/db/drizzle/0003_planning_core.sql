CREATE TYPE "workspace_member_role" AS ENUM (
  'owner',
  'admin',
  'member',
  'viewer'
);

CREATE TYPE "project_status" AS ENUM (
  'planned',
  'in_progress',
  'paused',
  'completed',
  'archived'
);

ALTER TABLE "work_items"
  ADD COLUMN "assignee_user_id" text,
  ADD COLUMN "workspace_id" uuid,
  ADD COLUMN "project_id" uuid,
  ADD COLUMN "sequence_number" integer DEFAULT 0 NOT NULL;

CREATE TABLE "workspaces" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "owner_user_id" text NOT NULL,
  "name" varchar(128) NOT NULL,
  "slug" varchar(64) NOT NULL UNIQUE,
  "description" text,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone
);

CREATE TABLE "workspace_members" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id" uuid NOT NULL,
  "user_id" text NOT NULL,
  "role" "workspace_member_role" DEFAULT 'member' NOT NULL,
  "joined_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE "projects" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id" uuid NOT NULL,
  "lead_user_id" text,
  "name" varchar(128) NOT NULL,
  "key" varchar(16) NOT NULL,
  "description" text,
  "color" varchar(7),
  "status" "project_status" DEFAULT 'planned' NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone
);

ALTER TABLE "workspaces"
  ADD CONSTRAINT "workspaces_owner_user_id_user_id_fk"
  FOREIGN KEY ("owner_user_id") REFERENCES "user"("id") ON DELETE CASCADE;

ALTER TABLE "workspace_members"
  ADD CONSTRAINT "workspace_members_workspace_id_workspaces_id_fk"
  FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE;

ALTER TABLE "workspace_members"
  ADD CONSTRAINT "workspace_members_user_id_user_id_fk"
  FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;

ALTER TABLE "projects"
  ADD CONSTRAINT "projects_workspace_id_workspaces_id_fk"
  FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE;

ALTER TABLE "projects"
  ADD CONSTRAINT "projects_lead_user_id_user_id_fk"
  FOREIGN KEY ("lead_user_id") REFERENCES "user"("id") ON DELETE SET NULL;
