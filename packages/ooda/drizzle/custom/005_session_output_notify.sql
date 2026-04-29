-- Session output NOTIFY trigger
--
-- Fires on INSERT into session_event so SSE subscribers can stream
-- chunks in real-time. Same pattern as 001_buddy_notify.sql.
-- Payload: { session_id, type }.

CREATE OR REPLACE FUNCTION notify_session_output() RETURNS trigger AS $$
BEGIN
  PERFORM pg_notify(
    'session_output',
    json_build_object(
      'session_id', NEW.session_id,
      'type', NEW.type
    )::text
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS session_output_notify ON public.session_event;
CREATE TRIGGER session_output_notify
AFTER INSERT ON public.session_event
FOR EACH ROW EXECUTE FUNCTION notify_session_output();
