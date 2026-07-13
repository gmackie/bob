-- Bob production v1 "Unattended Trust Slice" schema.
--
-- Forward migration for the gateway trust machinery introduced on
-- feat/production-v1. The runner + gateway write these tables/columns/enum
-- values at runtime, so this MUST be applied before the new gateway boots
-- (deploy.sh runs migrate-hetzner.sh first). Idempotent: safe to re-run.
--
--   * agent_run_status enum gains blocked / host_unknown
--   * agent_runs + chat_conversations gain immutable dispatch_spec
--   * session_events gains runner send_seq + ingest-dedup unique index
--   * runner_leases     — host/connector liveness identity (single writer)
--   * notification_outbox — transactional push outbox (exactly-once intent)
--   * gateway_config    — single-row live tunables (heartbeat/grace/retention)

-- --- agent_run_status enum: new paused/lost states -------------------------
-- PG12+ allows ADD VALUE inside a transaction as long as the value is not used
-- in the same transaction (it is not — the runtime writes them later).
--
-- 'interrupted' is NOT a new value from this branch: schema.ts has declared it
-- since the run-lifecycle work, but no SQL migration ever added it (it reached
-- dev databases via `drizzle-kit push`). The committed enum is still
-- ('queued','running','completed','failed'), so any production write of
-- 'interrupted' would fail. Add it here defensively — IF NOT EXISTS makes this
-- a no-op wherever push already applied it.
ALTER TYPE "agent_run_status" ADD VALUE IF NOT EXISTS 'interrupted';
ALTER TYPE "agent_run_status" ADD VALUE IF NOT EXISTS 'blocked';
ALTER TYPE "agent_run_status" ADD VALUE IF NOT EXISTS 'host_unknown';

-- --- immutable dispatch specification (retry re-dispatches from this) -------
ALTER TABLE "agent_runs" ADD COLUMN IF NOT EXISTS "dispatch_spec" json;
ALTER TABLE "chat_conversations" ADD COLUMN IF NOT EXISTS "dispatch_spec" json;

-- --- session_events: runner send-seq + ingest dedup ------------------------
ALTER TABLE "session_events" ADD COLUMN IF NOT EXISTS "send_seq" bigint;
-- Non-unique lookup index for the replay query (WHERE session_id=? AND seq>?).
-- It is NOT unique: production session_events has historical duplicate
-- (session_id, seq) rows (pre-dating the atomic nextSeq increment), so a unique
-- constraint here is unenforceable without destructive dedup. Ingest dedup is
-- enforced by the (session_id, send_seq) unique index below, which is what the
-- envelope protocol actually relies on.
CREATE INDEX IF NOT EXISTS "session_events_session_seq_idx"
  ON "session_events" ("session_id", "seq");
-- Ingest dedup: at-least-once redelivery from the runner disk buffer must not
-- produce a second row. NULL send_seq (gateway-originated) is unconstrained.
CREATE UNIQUE INDEX IF NOT EXISTS "session_events_session_send_seq_unique"
  ON "session_events" ("session_id", "send_seq");

-- --- runner_leases: host/connector liveness identity -----------------------
CREATE TABLE IF NOT EXISTS "runner_leases" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "workspace_id" uuid NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "host_id" text NOT NULL,
  "connector_instance_id" text NOT NULL,
  "daemon_version" text,
  "started_at" timestamp with time zone NOT NULL DEFAULT now(),
  "last_heartbeat_at" timestamp with time zone NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "runner_leases_workspace_host_unique"
  ON "runner_leases" ("workspace_id", "host_id");

-- --- notification_outbox: transactional push outbox ------------------------
CREATE TABLE IF NOT EXISTS "notification_outbox" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "session_id" uuid NOT NULL,
  "user_id" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "transition" varchar(30) NOT NULL,
  "source_send_seq" bigint NOT NULL,
  "status" varchar(12) NOT NULL DEFAULT 'pending',
  "attempts" integer NOT NULL DEFAULT 0,
  "claimed_at" timestamp with time zone,
  "sent_at" timestamp with time zone,
  "last_error" text,
  "message_id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "payload" json NOT NULL DEFAULT '{}'::json,
  "expo_tickets" json,
  "receipts_resolved_at" timestamp with time zone,
  "seen_at" timestamp with time zone,
  "created_at" timestamp NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "notification_outbox_occurrence_unique"
  ON "notification_outbox" ("session_id", "transition", "source_send_seq");
CREATE INDEX IF NOT EXISTS "notification_outbox_status_idx"
  ON "notification_outbox" ("status");
CREATE INDEX IF NOT EXISTS "notification_outbox_user_idx"
  ON "notification_outbox" ("user_id");

-- --- gateway_config: single-row live tunables ------------------------------
CREATE TABLE IF NOT EXISTS "gateway_config" (
  "id" integer PRIMARY KEY DEFAULT 1,
  "heartbeat_interval_ms" integer NOT NULL DEFAULT 15000,
  "lease_grace_ms" integer NOT NULL DEFAULT 60000,
  "event_retention_days" integer NOT NULL DEFAULT 30,
  "updated_at" timestamp with time zone
);

-- --- performance: active-session status filter (sweep + pending queries) ----
-- Partial index so the lease sweep's chat_conversations status scan and the
-- daemon-connect pending-sessions query don't sequential-scan an ever-growing
-- table (see relay.ts sweepExpiredLeases / pending-session replay).
CREATE INDEX IF NOT EXISTS "chat_conversations_active_status_idx"
  ON "chat_conversations" ("status")
  WHERE "status" IN ('pending','provisioning','starting','running','blocked','idle','stopping','host_unknown');
