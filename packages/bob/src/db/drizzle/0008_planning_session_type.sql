ALTER TABLE chat_conversations
  ADD COLUMN IF NOT EXISTS planning_session_type VARCHAR(30);

COMMENT ON COLUMN chat_conversations.planning_session_type IS
  'Fine-grained type for planning sessions: office_hours, ceo_review, eng_review, design_review, breakdown. Null for non-planning sessions.';
