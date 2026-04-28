CREATE TABLE IF NOT EXISTS run_lifecycle_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_run_id UUID NOT NULL REFERENCES task_runs(id) ON DELETE CASCADE,
  work_item_id UUID REFERENCES work_items(id) ON DELETE SET NULL,
  session_id UUID REFERENCES chat_conversations(id) ON DELETE SET NULL,
  event_type VARCHAR(40) NOT NULL,
  phase VARCHAR(20) NOT NULL,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMP DEFAULT now() NOT NULL
);

COMMENT ON COLUMN run_lifecycle_events.event_type IS 'Event types: run_started, run_completed, run_failed, phase_changed, artifact_created, plan_approved, plan_rejected, brd_generated, tasks_dispatched';
COMMENT ON COLUMN run_lifecycle_events.phase IS 'Phase when event occurred: shape, plan, execute, review, ship';

CREATE INDEX IF NOT EXISTS run_lifecycle_events_run_idx ON run_lifecycle_events(task_run_id);
CREATE INDEX IF NOT EXISTS run_lifecycle_events_type_idx ON run_lifecycle_events(event_type);
