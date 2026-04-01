create type "tenant_plan" as enum ('free', 'premium', 'pro');

create type "tenant_member_role" as enum ('owner', 'admin', 'member');

create table "tenants" (
  "id" uuid primary key default gen_random_uuid() not null,
  "name" varchar(128) not null,
  "slug" varchar(64) not null unique,
  "plan" "tenant_plan" default 'free' not null,
  "forge_graph_project_id" text,
  "created_at" timestamp default now() not null,
  "updated_at" timestamp default now() not null
);

create table "tenant_members" (
  "id" uuid primary key default gen_random_uuid() not null,
  "tenant_id" uuid not null,
  "user_id" text not null,
  "role" "tenant_member_role" default 'member' not null,
  "joined_at" timestamp default now() not null
);

alter table "tenant_members"
  add constraint "tenant_members_tenant_id_tenants_id_fk"
  foreign key ("tenant_id") references "tenants"("id") on delete cascade;

create unique index "tenant_members_tenant_user_idx"
  on "tenant_members" ("tenant_id", "user_id");

alter table "workspaces"
  add column "tenant_id" uuid,
  add column "machine_id" text,
  add column "last_heartbeat" timestamp,
  add column "agent_configs" json;

alter table "workspaces"
  add constraint "workspaces_tenant_id_tenants_id_fk"
  foreign key ("tenant_id") references "tenants"("id") on delete cascade;

create type "agent_run_status" as enum ('queued', 'running', 'completed', 'failed');

create table "agent_runs" (
  "id" uuid primary key default gen_random_uuid() not null,
  "work_item_id" text not null,
  "workspace_id" uuid not null,
  "tenant_id" uuid not null,
  "agent_type" varchar(64) not null,
  "agent_config" json,
  "status" "agent_run_status" default 'queued' not null,
  "started_at" timestamp,
  "completed_at" timestamp,
  "summary" json,
  "created_at" timestamp default now() not null
);

alter table "agent_runs"
  add constraint "agent_runs_workspace_id_workspaces_id_fk"
  foreign key ("workspace_id") references "workspaces"("id") on delete cascade;

alter table "agent_runs"
  add constraint "agent_runs_tenant_id_tenants_id_fk"
  foreign key ("tenant_id") references "tenants"("id") on delete cascade;

create index "agent_runs_workspace_idx" on "agent_runs" ("workspace_id");
create index "agent_runs_tenant_idx" on "agent_runs" ("tenant_id");
create index "agent_runs_work_item_idx" on "agent_runs" ("work_item_id");

create type "run_artifact_type" as enum ('diff', 'log', 'test-report', 'file-snapshot');

create table "run_artifacts" (
  "id" uuid primary key default gen_random_uuid() not null,
  "run_id" uuid not null,
  "type" "run_artifact_type" not null,
  "storage_key" text not null,
  "metadata" json,
  "created_at" timestamp default now() not null
);

alter table "run_artifacts"
  add constraint "run_artifacts_run_id_agent_runs_id_fk"
  foreign key ("run_id") references "agent_runs"("id") on delete cascade;

create index "run_artifacts_run_idx" on "run_artifacts" ("run_id");
