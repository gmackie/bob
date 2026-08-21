CREATE TABLE IF NOT EXISTS "hermes_approval_consumptions" (
  "approval_id" text PRIMARY KEY NOT NULL,
  "proposal_id" text NOT NULL,
  "owner" varchar(32) NOT NULL,
  "scope_digest" text NOT NULL,
  "execution_id" text NOT NULL,
  "idempotency_key" text NOT NULL,
  "consumed_at" timestamptz NOT NULL,
  "expires_at" timestamptz NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "hermes_approval_consumptions_execution_unique"
  ON "hermes_approval_consumptions" ("execution_id");

CREATE UNIQUE INDEX IF NOT EXISTS "hermes_approval_consumptions_idempotency_unique"
  ON "hermes_approval_consumptions" ("idempotency_key");
