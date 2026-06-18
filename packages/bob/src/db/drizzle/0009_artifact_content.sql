ALTER TYPE work_item_artifact_type ADD VALUE IF NOT EXISTS 'planning_doc';
ALTER TYPE work_item_activity_type ADD VALUE IF NOT EXISTS 'planning_session_completed';

ALTER TABLE work_item_artifacts
  ADD COLUMN IF NOT EXISTS content TEXT,
  ADD COLUMN IF NOT EXISTS session_id UUID REFERENCES chat_conversations(id) ON DELETE SET NULL;

ALTER TABLE work_item_artifacts
  ALTER COLUMN url DROP NOT NULL;
