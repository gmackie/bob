ALTER TABLE "work_items" ADD COLUMN IF NOT EXISTS "queue_sort_order" integer DEFAULT 0 NOT NULL;

CREATE INDEX IF NOT EXISTS "work_items_workspace_queue_idx"
  ON "work_items" ("workspace_id", "queue_sort_order");
