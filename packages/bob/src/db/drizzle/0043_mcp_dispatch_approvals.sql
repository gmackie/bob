-- Remote MCP planning review: a person's approval to dispatch a work item, recorded
-- before the dispatch tool will run it. One row per work item; dispatched_at marks
-- that the approval was spent.
CREATE TABLE mcp_dispatch_approvals (
  work_item_id uuid PRIMARY KEY REFERENCES work_items(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  approved_by text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  approved_at timestamptz NOT NULL DEFAULT now(),
  dispatched_at timestamptz
);
