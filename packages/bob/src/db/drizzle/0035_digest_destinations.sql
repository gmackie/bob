CREATE TABLE digest_destinations (
  scope text PRIMARY KEY, workspace_id uuid NOT NULL,
  issue_id text, phase text NOT NULL DEFAULT 'ready'
);
CREATE TABLE digest_deliveries (
  key text PRIMARY KEY, scope text NOT NULL, date text NOT NULL,
  phase text NOT NULL DEFAULT 'ready'
);
