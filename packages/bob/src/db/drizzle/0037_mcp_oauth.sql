CREATE TABLE mcp_oauth_clients (
  id text PRIMARY KEY, name text NOT NULL, redirect_uris jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE mcp_oauth_grants (
  id text PRIMARY KEY,
  client_id text NOT NULL REFERENCES mcp_oauth_clients(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  scopes jsonb NOT NULL, resource text NOT NULL,
  expires_at timestamptz NOT NULL, revoked_at timestamptz
);
CREATE INDEX mcp_oauth_grants_user_idx ON mcp_oauth_grants(user_id);
CREATE TABLE mcp_oauth_credentials (
  hash text PRIMARY KEY, kind text NOT NULL,
  grant_id text REFERENCES mcp_oauth_grants(id) ON DELETE CASCADE,
  data jsonb NOT NULL, expires_at timestamptz NOT NULL, used_at timestamptz
);
CREATE INDEX mcp_oauth_credentials_expiry_idx ON mcp_oauth_credentials(expires_at);
CREATE INDEX mcp_oauth_credentials_grant_idx ON mcp_oauth_credentials(grant_id);
