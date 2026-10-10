CREATE TABLE coordination_attempt (
  "tenant" TEXT NOT NULL,
  "id" TEXT NOT NULL,
  "owner" TEXT NOT NULL,
  "plan_id" TEXT NOT NULL,
  "item_id" TEXT NOT NULL,
  "request_id" TEXT NOT NULL,
  "operation_id" TEXT NOT NULL,
  "request" TEXT NOT NULL,
  "state" TEXT NOT NULL,
  "admission" TEXT,
  "terminal" TEXT,
  "last_sequence" INTEGER NOT NULL,
  "lease_owner" TEXT,
  "lease_until" INTEGER,
  PRIMARY KEY (tenant, id)
);
CREATE UNIQUE INDEX coordination_attempt_uq_requestId ON coordination_attempt (tenant, request_id);
CREATE INDEX coordination_attempt_ix_by_owner_plan_id_state ON coordination_attempt (tenant, owner, plan_id, state, id);
