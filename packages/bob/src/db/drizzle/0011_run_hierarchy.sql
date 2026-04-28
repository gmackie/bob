ALTER TABLE task_runs
  ADD COLUMN IF NOT EXISTS parent_task_run_id UUID REFERENCES task_runs(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS run_phase VARCHAR(20) NOT NULL DEFAULT 'execute';

COMMENT ON COLUMN task_runs.run_phase IS 'Lifecycle phase: shape, plan, execute, review, ship';

CREATE INDEX IF NOT EXISTS task_runs_parent_idx ON task_runs(parent_task_run_id);
CREATE INDEX IF NOT EXISTS task_runs_phase_idx ON task_runs(run_phase);
