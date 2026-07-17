-- Per-integration GraphQL endpoint. NULL keeps the @linear/sdk default
-- (https://api.linear.app/graphql), so existing rows are unaffected. Set it to
-- point Bob at a Linear-API-compatible instance instead of Linear itself —
-- e.g. Kanbanger at https://tasks.gmac.io/graphql, which speaks the same wire
-- protocol and accepts the same key formats.
ALTER TABLE "workspace_integrations" ADD COLUMN IF NOT EXISTS "linear_api_url" text;
