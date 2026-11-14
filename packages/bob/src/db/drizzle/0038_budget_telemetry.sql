-- BOB-76: subscription budget telemetry.
--
-- Written by the ws-gateway from runner heartbeats and budget_usage messages.
-- Every write is an idempotent upsert of absolute values, so a resent or
-- duplicated message can never double-count. No column holds an API key, an
-- email, a client address or an interactive session id.

-- Provider utilization meters as the proxy last saw them, one row per
-- distinct observation. model = '' is the account-level meter.
CREATE TABLE budget_meter_samples (
  workspace_id uuid NOT NULL,
  host_id text NOT NULL,
  account_id text NOT NULL,
  auth_index text,
  provider text NOT NULL,
  model text NOT NULL DEFAULT '',
  window_name text NOT NULL,
  window_minutes integer,
  used_percent real NOT NULL CHECK (used_percent >= 0 AND used_percent <= 100),
  resets_at timestamptz,
  status text,
  observed_at timestamptz NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, account_id, model, window_name, observed_at)
);
CREATE INDEX budget_meter_samples_recent_idx
  ON budget_meter_samples (workspace_id, provider, observed_at DESC);

-- Hourly token ledger per serving account, model and source (bob | interactive).
CREATE TABLE budget_usage_ledger (
  workspace_id uuid NOT NULL,
  host_id text NOT NULL,
  hour timestamptz NOT NULL,
  auth_index text NOT NULL,
  provider text NOT NULL,
  model text NOT NULL,
  source text NOT NULL CHECK (source IN ('bob', 'interactive')),
  requests integer NOT NULL DEFAULT 0,
  failed integer NOT NULL DEFAULT 0,
  input_tokens bigint NOT NULL DEFAULT 0,
  output_tokens bigint NOT NULL DEFAULT 0,
  reasoning_tokens bigint NOT NULL DEFAULT 0,
  cache_read_tokens bigint NOT NULL DEFAULT 0,
  cache_creation_tokens bigint NOT NULL DEFAULT 0,
  total_tokens bigint NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, host_id, hour, auth_index, model, source)
);
CREATE INDEX budget_usage_ledger_hour_idx ON budget_usage_ledger (workspace_id, hour DESC);

-- Totals per Bob agent session (the proxy's session_id), joined to runs for
-- per-work-item cost. meters_first / meters_last bracket what the session cost.
CREATE TABLE budget_session_usage (
  workspace_id uuid NOT NULL,
  host_id text NOT NULL,
  session_id text NOT NULL,
  auth_index text NOT NULL,
  provider text NOT NULL,
  model text NOT NULL,
  requests integer NOT NULL DEFAULT 0,
  failed integer NOT NULL DEFAULT 0,
  input_tokens bigint NOT NULL DEFAULT 0,
  output_tokens bigint NOT NULL DEFAULT 0,
  reasoning_tokens bigint NOT NULL DEFAULT 0,
  cache_read_tokens bigint NOT NULL DEFAULT 0,
  cache_creation_tokens bigint NOT NULL DEFAULT 0,
  total_tokens bigint NOT NULL DEFAULT 0,
  first_at timestamptz NOT NULL,
  last_at timestamptz NOT NULL,
  meters_first jsonb,
  meters_last jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, session_id)
);
CREATE INDEX budget_session_usage_last_idx ON budget_session_usage (workspace_id, last_at DESC);
