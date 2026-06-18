-- Buddy LISTEN/NOTIFY triggers
--
-- Hand-rolled migration applied AFTER drizzle-kit's generated migrations.
-- Apply via: `pnpm --filter @ooda/db migrate:custom` (see src/migrate-custom.ts).
--
-- All statements are idempotent: functions use CREATE OR REPLACE and triggers
-- are recreated via DROP IF EXISTS + CREATE (portable across PG 13+).
--
-- Channels:
--   buddy_tool_call    — AFTER INSERT/UPDATE on public.tool_call_log
--   buddy_dive_update  — AFTER INSERT/UPDATE on public.graph_exploration
--   buddy_inbox_new    — AFTER INSERT on {personal,research}_vault.findings_inbox

-- -----------------------------------------------------------------------------
-- buddy_tool_call
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION notify_buddy_tool_call() RETURNS trigger AS $$
BEGIN
  PERFORM pg_notify(
    'buddy_tool_call',
    json_build_object(
      'id', NEW.id,
      'thread_id', NEW.thread_id,
      'tool_name', NEW.tool_name,
      'op', TG_OP
    )::text
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS buddy_tool_call_notify ON public.tool_call_log;
CREATE TRIGGER buddy_tool_call_notify
AFTER INSERT OR UPDATE ON public.tool_call_log
FOR EACH ROW EXECUTE FUNCTION notify_buddy_tool_call();

-- -----------------------------------------------------------------------------
-- buddy_dive_update
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION notify_buddy_dive_update() RETURNS trigger AS $$
BEGIN
  PERFORM pg_notify(
    'buddy_dive_update',
    json_build_object(
      'id', NEW.id,
      'thread_id', NEW.thread_id,
      'status', NEW.status,
      'op', TG_OP
    )::text
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS buddy_dive_update_notify ON public.graph_exploration;
CREATE TRIGGER buddy_dive_update_notify
AFTER INSERT OR UPDATE ON public.graph_exploration
FOR EACH ROW EXECUTE FUNCTION notify_buddy_dive_update();

-- -----------------------------------------------------------------------------
-- buddy_inbox_new (per-vault: personal_vault + research_vault)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION notify_buddy_inbox_new() RETURNS trigger AS $$
BEGIN
  PERFORM pg_notify(
    'buddy_inbox_new',
    json_build_object(
      'id', NEW.id,
      'source_id', NEW.source_id,
      'vault', TG_TABLE_SCHEMA,
      'op', TG_OP
    )::text
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS buddy_inbox_new_notify_personal ON personal_vault.findings_inbox;
CREATE TRIGGER buddy_inbox_new_notify_personal
AFTER INSERT ON personal_vault.findings_inbox
FOR EACH ROW EXECUTE FUNCTION notify_buddy_inbox_new();

DROP TRIGGER IF EXISTS buddy_inbox_new_notify_research ON research_vault.findings_inbox;
CREATE TRIGGER buddy_inbox_new_notify_research
AFTER INSERT ON research_vault.findings_inbox
FOR EACH ROW EXECUTE FUNCTION notify_buddy_inbox_new();
