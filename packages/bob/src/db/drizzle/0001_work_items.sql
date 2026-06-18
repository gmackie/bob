CREATE TYPE "work_item_kind" AS ENUM ('issue', 'epic', 'task');

CREATE TABLE "work_items" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "parent_id" uuid,
  "owner_user_id" text NOT NULL,
  "kind" "work_item_kind" NOT NULL,
  "title" varchar(256) NOT NULL,
  "description" text,
  "status" varchar(40) DEFAULT 'draft' NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone
);

ALTER TABLE "work_items"
  ADD CONSTRAINT "work_items_owner_user_id_user_id_fk"
  FOREIGN KEY ("owner_user_id") REFERENCES "user"("id") ON DELETE CASCADE;

ALTER TABLE "work_items"
  ADD CONSTRAINT "work_items_parent_id_work_items_id_fk"
  FOREIGN KEY ("parent_id") REFERENCES "work_items"("id") ON DELETE SET NULL;
