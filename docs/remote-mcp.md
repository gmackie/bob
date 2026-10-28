# Remote MCP connections

Bob exposes a stateless MCP Streamable HTTP endpoint at
`https://bob.blder.bot/mcp` after this feature is deployed. In a remote MCP
client, add that URL and select OAuth authentication. Sign in with GitHub,
review the requested permissions, select one workspace, and allow the
connection. A separate connection is needed for each workspace.

The server supports standard OAuth discovery, dynamic registration for public
clients (`token_endpoint_auth_method: none`), and authorization-code PKCE
(S256). Client callbacks must be exact registered HTTPS URLs; loopback HTTP
callbacks are accepted for local clients. No wildcard callbacks or shared API
keys are needed. Authorization and token requests must set
`resource=https://bob.blder.bot/mcp`. Confidential client authentication and
client-ID metadata documents are not supported in this first version; clients
must use dynamic registration and public-client PKCE.

Use `bob:read` for project and work-item access. Request `bob:read bob:write`
to also edit work-item titles/descriptions and add comments. Workspace viewers
cannot authorize writes. Each call rechecks membership and write permissions.
Tools accept UUIDs; `bob_list_projects` and `bob_list_work_items` discover them.
Project lists paginate with `offset`, `limit`, and `nextOffset`. Work-item lists
return at most 100 recent entries, with optional `projectId` and `status` filters.

| Tool | Scope |
| --- | --- |
| `bob_list_projects` | `bob:read` |
| `bob_get_project` | `bob:read` |
| `bob_list_work_items` | `bob:read` |
| `bob_get_work_item` | `bob:read` |
| `bob_update_work_item` | `bob:write` |
| `bob_add_comment` | `bob:write` |

MCP protocol versions: `2025-11-25`, `2025-06-18`, and `2025-03-26`.
POST requests require `Accept: application/json, text/event-stream`. Responses
are JSON. There is no persistent MCP session or server-initiated SSE stream;
GET and DELETE return 405 after authentication. Notifications return 202.

The official MCP SDK client is covered by an interoperability test. Connections
in the intended Grok, OpenAI, and Claude products still need verification in
those clients; product names and available connector features vary. A client
requiring a client secret, legacy HTTP+SSE transport, or special search/fetch
tools will need additional support.

## Operations

Apply `packages/bob/src/db/drizzle/0037_mcp_oauth.sql` through the existing Bob
guarded production migration runner (`pnpm --filter @bob/blder predeploy`) before deploying the Worker. The schema is additive. Set
`FRONTEND_URL` to the canonical public origin; discovery and token audiences
never trust request Host headers. Existing Bob session auth and Postgres are
used. No additional signing secret is required: access and refresh credentials
are random opaque tokens stored only as SHA-256 hashes.

Access tokens last one hour. Refresh tokens rotate on every exchange; replay
revokes the entire connection. Grants expire after 30 days and require consent
again. Revoke a connection with POST `/oauth/revoke`, sending form-encoded
`client_id` and `token` (either access or refresh). It invalidates all tokens
for that grant. Account/workspace deletion cascades to grants and credentials.

Browser-based clients must have their exact Origin added to the comma-separated
`BOB_MCP_ALLOWED_ORIGINS` setting. Server-to-server clients normally omit Origin.
Discovery permits public CORS; consent is same-origin and requires a real
cookie session plus a one-use, user-bound consent token. Existing rate limits
apply per Worker isolate; use Cloudflare rate-limiting rules for global abuse
protection if needed.

Periodically remove expired OAuth credentials and grants. Retain consumed
refresh credentials until their grant expires to preserve replay detection.
Client registrations persist and may be removed when no longer needed.

Verify after deployment:

```sh
curl -i https://bob.blder.bot/.well-known/oauth-protected-resource/mcp
curl -i https://bob.blder.bot/.well-known/oauth-authorization-server
curl -i https://bob.blder.bot/mcp
```

Expect discovery JSON pointing at the public origin, followed by a 401 with a
`WWW-Authenticate` header containing the resource metadata URL. Complete an
OAuth connection and call `bob_list_projects` in the target client to verify
consent, the token exchange, and workspace access end to end.

Local verification:

```sh
pnpm --filter @bob/blder exec vitest run src/server/mcp/
pnpm --filter @bob/blder typecheck
pnpm --filter @bob/blder build
```
