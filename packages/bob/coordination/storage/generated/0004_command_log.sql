CREATE TABLE coordination_command_log (
  "tenant" TEXT NOT NULL,
  "id" TEXT NOT NULL,
  "command_id" TEXT NOT NULL,
  "owner" TEXT NOT NULL,
  "operation" TEXT NOT NULL,
  "actor" TEXT,
  "resource_id" TEXT,
  "operation_id" TEXT,
  "outcome" TEXT NOT NULL,
  "created_at" TEXT NOT NULL,
  PRIMARY KEY (tenant, id)
);
CREATE INDEX coordination_command_log_ix_by_command_id ON coordination_command_log (tenant, command_id, id);
CREATE INDEX coordination_command_log_ix_by_owner_created_at ON coordination_command_log (tenant, owner, created_at, id);
