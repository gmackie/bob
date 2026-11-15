-- BOB-76 Phase 6: join proxy usage to Bob runs.
-- The proxy reports usage under the agent CLI's own session id (Claude's
-- session_id, Codex's thread_id); the runner reads that id from the CLI's
-- first output line and links it to the Bob run session (chat_conversations.id).
CREATE TABLE budget_session_links (
  workspace_id uuid NOT NULL,
  native_session_id text NOT NULL,
  bob_session_id text NOT NULL,
  linked_at timestamptz NOT NULL,
  PRIMARY KEY (workspace_id, native_session_id)
);
CREATE INDEX budget_session_links_bob_idx ON budget_session_links (bob_session_id);
