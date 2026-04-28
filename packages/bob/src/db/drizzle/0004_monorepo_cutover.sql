ALTER TABLE "chat_conversations"
  ADD COLUMN "work_item_id" uuid,
  ADD COLUMN "work_item_identifier_snapshot" text;

ALTER TABLE "task_runs"
  ADD COLUMN "work_item_id" uuid,
  ADD COLUMN "work_item_identifier_snapshot" text;

ALTER TABLE "chat_conversations"
  ADD CONSTRAINT "chat_conversations_work_item_id_work_items_id_fk"
  FOREIGN KEY ("work_item_id") REFERENCES "work_items"("id") ON DELETE SET NULL;

ALTER TABLE "task_runs"
  ADD CONSTRAINT "task_runs_work_item_id_work_items_id_fk"
  FOREIGN KEY ("work_item_id") REFERENCES "work_items"("id") ON DELETE SET NULL;

CREATE INDEX "chat_conversations_work_item_id_idx"
  ON "chat_conversations" ("work_item_id");

CREATE INDEX "task_runs_work_item_id_idx"
  ON "task_runs" ("work_item_id");

UPDATE "task_runs"
SET "work_item_identifier_snapshot" = COALESCE(
  "work_item_identifier_snapshot",
  "kanbanger_issue_identifier"
)
WHERE "kanbanger_issue_identifier" IS NOT NULL;

UPDATE "chat_conversations"
SET "work_item_identifier_snapshot" = COALESCE(
  "work_item_identifier_snapshot",
  "kanbanger_task_id"
)
WHERE "kanbanger_task_id" IS NOT NULL;
