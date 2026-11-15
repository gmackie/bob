-- BOB-76 Phase 2: budget governor state.

-- Latest known state of each proxy account, refreshed from runner heartbeats.
-- Labels are already masked by the runner (first character + domain).
CREATE TABLE budget_accounts (
  workspace_id uuid NOT NULL,
  account_id text NOT NULL,
  host_id text NOT NULL,
  auth_index text,
  provider text NOT NULL,
  label text NOT NULL,
  status text NOT NULL,
  detail text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, account_id)
);

-- One policy row ('default'). Validated and defaulted in code
-- (normalizeBudgetPolicy), so older rows keep working as levers are added.
CREATE TABLE budget_policy (
  id text PRIMARY KEY,
  policy jsonb NOT NULL,
  updated_by text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Audit trail of lever changes: who changed what, and the predicted impact.
CREATE TABLE budget_policy_changes (
  id bigserial PRIMARY KEY,
  changed_by text,
  before jsonb NOT NULL,
  after jsonb NOT NULL,
  note text,
  changed_at timestamptz NOT NULL DEFAULT now()
);

-- One row per governor evaluation (autoDrain tick): what it allowed and why.
CREATE TABLE budget_decisions (
  id bigserial PRIMARY KEY,
  decided_at timestamptz NOT NULL DEFAULT now(),
  enforce boolean NOT NULL,
  mode text NOT NULL,
  total_slots integer NOT NULL,
  legacy_budget integer,
  dispatched integer,
  verdict jsonb NOT NULL,
  inputs jsonb NOT NULL
);
CREATE INDEX budget_decisions_decided_at_idx ON budget_decisions (decided_at DESC);
