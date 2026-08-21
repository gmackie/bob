CREATE TABLE IF NOT EXISTS "hermes_usage_events" (
  "record_id" text PRIMARY KEY NOT NULL,
  "request_id_digest" text NOT NULL,
  "actor_user_id_digest" text NOT NULL,
  "intent" varchar(32) NOT NULL,
  "channel" varchar(32) NOT NULL,
  "owner" varchar(32) NOT NULL,
  "risk_class" varchar(8) NOT NULL,
  "outcome" varchar(32) NOT NULL,
  "duration_bucket" varchar(16) NOT NULL,
  "evidence" varchar(16) NOT NULL,
  "observed_at" timestamptz NOT NULL,
  CONSTRAINT "hermes_usage_events_record_digest_check" CHECK ("record_id" ~ '^sha256:[a-f0-9]{64}$'),
  CONSTRAINT "hermes_usage_events_request_digest_check" CHECK ("request_id_digest" ~ '^sha256:[a-f0-9]{64}$'),
  CONSTRAINT "hermes_usage_events_actor_digest_check" CHECK ("actor_user_id_digest" ~ '^sha256:[a-f0-9]{64}$'),
  CONSTRAINT "hermes_usage_events_intent_check" CHECK ("intent" IN ('today', 'capture', 'research', 'work', 'approve', 'status', 'fleet', 'close', 'stop')),
  CONSTRAINT "hermes_usage_events_channel_check" CHECK ("channel" IN ('telegram', 'console', 'bob')),
  CONSTRAINT "hermes_usage_events_owner_check" CHECK ("owner" IN ('ooda', 'bob', 'skillfleet', 'forgegraph')),
  CONSTRAINT "hermes_usage_events_risk_check" CHECK ("risk_class" IN ('R0', 'R1', 'R2', 'R3', 'R4')),
  CONSTRAINT "hermes_usage_events_outcome_check" CHECK ("outcome" IN ('success', 'failure', 'cancelled', 'blocked', 'replayed', 'policy_rejected')),
  CONSTRAINT "hermes_usage_events_duration_check" CHECK ("duration_bucket" IN ('<1s', '1-10s', '10-60s', '1-5m', '>5m', 'unknown')),
  CONSTRAINT "hermes_usage_events_evidence_check" CHECK ("evidence" IN ('complete', 'partial', 'unknown'))
);

CREATE UNIQUE INDEX IF NOT EXISTS "hermes_usage_events_request_observation_unique"
  ON "hermes_usage_events" ("request_id_digest", "observed_at");
