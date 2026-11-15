CREATE TABLE coordination_input_delivery (
  "tenant" TEXT NOT NULL,
  "id" TEXT NOT NULL,
  "owner" TEXT NOT NULL,
  "attempt_id" TEXT NOT NULL,
  "item_id" TEXT NOT NULL,
  "thread_id" TEXT NOT NULL,
  "prompt_id" TEXT NOT NULL,
  "command_id" TEXT NOT NULL,
  "operation_id" TEXT NOT NULL,
  "answers" TEXT,
  "status" TEXT NOT NULL,
  "delivery_attempts" INTEGER NOT NULL,
  "next_attempt_at" INTEGER NOT NULL,
  "last_error" TEXT,
  "created_at" TEXT NOT NULL,
  "settled_at" TEXT,
  PRIMARY KEY (tenant, id)
);
CREATE UNIQUE INDEX coordination_input_delivery_uq_attemptId_promptId ON coordination_input_delivery (tenant, attempt_id, prompt_id);
CREATE INDEX coordination_input_delivery_ix_by_owner_status_next_attempt_at ON coordination_input_delivery (tenant, owner, status, next_attempt_at, id);
