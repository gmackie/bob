-- Agent selection hierarchy: per-work-item override -> project default ->
-- workspace default -> hardcoded fallback (see resolveAgentType).
ALTER TABLE "workspaces" ADD COLUMN "default_agent_type" varchar(50);
ALTER TABLE "projects" ADD COLUMN "default_agent_type" varchar(50);
ALTER TABLE "work_items" ADD COLUMN "agent_type_override" varchar(50);
