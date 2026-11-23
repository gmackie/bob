CREATE TABLE coordination_release (
  "tenant" TEXT NOT NULL,
  "id" TEXT NOT NULL,
  "owner" TEXT NOT NULL,
  "item_id" TEXT NOT NULL,
  "plan_id" TEXT NOT NULL,
  "stage" TEXT NOT NULL,
  "data" TEXT NOT NULL,
  "check_attempts" INTEGER NOT NULL,
  "next_check_at" INTEGER NOT NULL,
  "lease_owner" TEXT,
  "lease_until" INTEGER,
  "created_at" TEXT NOT NULL,
  "updated_at" TEXT NOT NULL,
  PRIMARY KEY (tenant, id)
);
CREATE INDEX coordination_release_ix_by_owner_stage_next_check_at ON coordination_release (tenant, owner, stage, next_check_at, id);
