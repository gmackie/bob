-- BOB-14: Real-time collaboration for planning sessions
-- Human collab chat + shared planning artifact versioning.

CREATE TABLE IF NOT EXISTS "planning_session_messages" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "session_id" uuid NOT NULL,
  "user_id" text NOT NULL,
  "client_message_id" text,
  "body" text NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "planning_session_messages_session_created_idx"
  ON "planning_session_messages" ("session_id", "created_at");

CREATE UNIQUE INDEX IF NOT EXISTS "planning_session_messages_client_message_uidx"
  ON "planning_session_messages" ("session_id", "user_id", "client_message_id")
  WHERE "client_message_id" IS NOT NULL;

ALTER TABLE "planning_session_messages"
  ADD CONSTRAINT "planning_session_messages_session_id_chat_conversations_id_fk"
  FOREIGN KEY ("session_id") REFERENCES "chat_conversations"("id") ON DELETE CASCADE;

ALTER TABLE "planning_session_messages"
  ADD CONSTRAINT "planning_session_messages_user_id_users_id_fk"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;

ALTER TABLE "work_item_artifacts"
  ADD COLUMN IF NOT EXISTS "content_version" integer NOT NULL DEFAULT 1;

ALTER TABLE "work_item_artifacts"
  ADD COLUMN IF NOT EXISTS "updated_at" timestamp with time zone;

ALTER TABLE "work_item_artifacts"
  ADD COLUMN IF NOT EXISTS "last_edited_by_user_id" text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'work_item_artifacts_last_edited_by_user_id_users_id_fk'
  ) THEN
    ALTER TABLE "work_item_artifacts"
      ADD CONSTRAINT "work_item_artifacts_last_edited_by_user_id_users_id_fk"
      FOREIGN KEY ("last_edited_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL;
  END IF;
END $$;
