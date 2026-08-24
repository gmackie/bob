-- Cockpit V2 controls.
--
-- disabled_agents: a manual "pull this agent from rotation" list that survives
-- redeploys (the automatic health gate is transient by design; this is the
-- human override, e.g. while a provider credential is known-dead).
ALTER TABLE "auto_drain_config" ADD COLUMN IF NOT EXISTS "disabled_agents" jsonb NOT NULL DEFAULT '[]'::jsonb;

-- cockpit_audit: one row per cockpit mutation (who pressed what, on what,
-- with what payload). The cockpit timeline renders these alongside Bob's own
-- events so human interventions are first-class history.
CREATE TABLE IF NOT EXISTS "cockpit_audit" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" text NOT NULL,
  "action" varchar(40) NOT NULL,
  "target" text,
  "payload" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "cockpit_audit_created_idx" ON "cockpit_audit" ("created_at");
