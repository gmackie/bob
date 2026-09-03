-- Per-type, per-channel notification preferences.
--
-- Delivery was two booleans on user_preferences, so a person could only choose
-- "every event" or silence — and an agent blocked waiting on them arrived in
-- the same stream as "batch completed".
--
-- Rows here are SPARSE: one exists only where a person expressed an opinion,
-- and everything else falls back to the defaults in
-- @bob/notifications/preferences. Writing 18 rows per user at signup would
-- make those defaults impossible to change later without migrating everyone.
CREATE TABLE IF NOT EXISTS "notification_preferences" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "type" "work_item_notification_type" NOT NULL,
  -- "push" | "email" | "in_app". Text rather than an enum so adding a channel
  -- does not need a migration; unknown values are ignored on read.
  "channel" varchar(16) NOT NULL,
  "enabled" boolean NOT NULL,
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "notification_preferences_user_idx"
  ON "notification_preferences" ("user_id");

-- One opinion per (user, type, channel); the upsert path keys on this.
CREATE UNIQUE INDEX IF NOT EXISTS "notification_preferences_unique_idx"
  ON "notification_preferences" ("user_id", "type", "channel");

-- Quiet hours, "HH:MM" in the user's existing timezone column. Null = none.
-- Suppresses push and email only: the in-app record is never withheld, because
-- quiet hours are about not being disturbed, not about losing history.
ALTER TABLE "user_preferences"
  ADD COLUMN IF NOT EXISTS "quiet_hours_start" varchar(5);
ALTER TABLE "user_preferences"
  ADD COLUMN IF NOT EXISTS "quiet_hours_end" varchar(5);
