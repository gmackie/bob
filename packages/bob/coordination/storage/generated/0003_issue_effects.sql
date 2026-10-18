CREATE TABLE coordination_issue_effect (
  "tenant" TEXT NOT NULL,
  "id" TEXT NOT NULL,
  "owner" TEXT NOT NULL,
  "attempt_id" TEXT NOT NULL,
  "fact" TEXT NOT NULL,
  "payload" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "delivery_attempts" INTEGER NOT NULL,
  "next_attempt_at" INTEGER NOT NULL,
  "last_error" TEXT,
  "lease_owner" TEXT,
  "lease_until" INTEGER,
  "created_at" TEXT NOT NULL,
  "delivered_at" TEXT,
  PRIMARY KEY (tenant, id)
);
CREATE UNIQUE INDEX coordination_issue_effect_uq_attemptId_fact ON coordination_issue_effect (tenant, attempt_id, fact);
CREATE INDEX coordination_issue_effect_ix_by_owner_status_next_attempt_at ON coordination_issue_effect (tenant, owner, status, next_attempt_at, id);
