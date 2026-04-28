-- Planning session execution context columns — populated by planSession.start,
-- consumed by ws-gateway + bob daemon when sessionType = 'planning'.
ALTER TABLE "chat_conversations" ADD COLUMN IF NOT EXISTS "planning_workspace_id" uuid;
ALTER TABLE "chat_conversations" ADD COLUMN IF NOT EXISTS "planning_project_id" uuid;
ALTER TABLE "chat_conversations" ADD COLUMN IF NOT EXISTS "planning_project_name" text;
ALTER TABLE "chat_conversations" ADD COLUMN IF NOT EXISTS "planning_launch_context" json;
