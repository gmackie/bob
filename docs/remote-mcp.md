# Remote MCP connections

Bob exposes a stateless MCP Streamable HTTP endpoint at
`https://bob.blder.bot/mcp`. Bob is an optional connection in T3 Code. In a remote MCP
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
| `bob_workspace` | `bob:read` |
| `bob_planning_review` | `bob:read` |
| `bob_runs_list`, `bob_work_item_get` | `bob:read` |
| `bob_linear_links` (`get`, `list`) | `bob:read` |
| `bob_linear_links` (`upsert`, `remove`) | `bob:write` |
| `bob_sdlc`, `bob_sdlc_item_for_thread` | `bob:read` |
| `bob_planning_approve` (view only) | `bob:write` |
| `bob_planning_dispatch` | `bob:write` |
| `bob_sdlc_connect` (view only) | `bob:write` |

## Views (MCP Apps)

The four panel contributions from `com.t3code.bob` v0.2.2 use these IDs and commands. Installations can request just `bob:read` for all four. T3 supplies its active thread through `hostContext.t3.threadId`.

| Panel ID | Title | Scope | Resource URI | Command ID |
| --- | --- | --- | --- | --- |
| `bob-workspace` | Bob planning | project | `ui://bob/workspace.html` | `bob-open-planning` |
| `bob-runs` | Bob runs | thread | `ui://bob/workspace.html` | `bob-open-runs` |
| `bob-sdlc` | Bob SDLC | thread | `ui://bob/sdlc.html` | `bob-open-sdlc` |
| `bob-sdlc-fleet` | Bob SDLC fleet | project | `ui://bob/sdlc.html` | `bob-open-sdlc-fleet` |

`bob_workspace` opens the workspace or thread-runs document. Pass optional Bob `projectId` and title `query` to filter work items, and optional `threadId` to filter runs. Use Bob’s `bob_list_projects` for project UUIDs. T3 project identifiers belong to the host. A supplied `workspaceId` must equal the OAuth grant. `bob_runs_list` accepts optional `workItemId` and `threadId`. Filters run before the result limit. Bob correlates session-backed T3 runs using the runner's stable thread ID. `bob_work_item_get({ workItemId })` returns the plugin's normalized `{ item }` shape alongside the existing `bob_get_work_item({ id })` API.

`bob_planning_review` and `bob_planning_dispatch` open the third resource, `ui://bob/planning-review.html`. Read-only connections see planning evidence. An authorized editor can approve from the view using `bob_planning_approve`, then dispatch once using `bob_planning_dispatch` when `BOB_OODA_DISPATCH_ENABLED=true`. Postgres stores approvals by work item and workspace. The dispatch result includes the normalized run (`id`, `providerId`, `status`) and Bob's `sessionId`, `identifier` and `sessionStatus`. MCP Apps hosts enforce the approval tool's `visibility: ["app"]`; direct OAuth clients with write access are trusted to honor this interaction.

`bob_sdlc({ threadId })` reads the matched item, pending questions, current attempt tail and CI. With no arguments it reads fleet counts, attention items and plan progress. `bob_sdlc_item_for_thread({ threadId })` returns the coordinator item and plan, with nulls for an unmatched thread. The service reads the workspace Durable Object only when the OAuth workspace matches `SDLC_EDGE_WORKSPACE_ID` and the user is on `SDLC_VIEWER_USER_IDS`. A reachable edge reports coordinator freshness with `offline`. Visible workspaces poll every 60 seconds by default. The service setting `BOB_POLL_SECONDS` accepts 15–3600 seconds. SDLC threads poll every 5 seconds and the fleet every 15. The three HTML resources use the host's MCP bridge and can run in a network-isolated frame. The older `bob_sdlc_connect` socket tool remains app-only and requires write access because its socket also accepts commands.

`bob_linear_links` stores manual Linear-compatible issue associations in Postgres. `get`, `remove` and `upsert` take `bobWorkItemId`. `upsert` also takes `linearIssueId` and optional `linearProjectId`. `list` returns `{ links, nextOffset }`, with a default page of 100. These associations are independent of tracker sync. New connections use server state. Existing local SQLite links can be carried over explicitly with `upsert`; historical local approvals require fresh review in Bob.

`resources/list` and `resources/read` serve `text/html;profile=mcp-app`. View-opening tools advertise both `_meta.ui.resourceUri` and `_meta["ui/resourceUri"]`. Regenerate the committed HTML after editing a view with `pnpm --filter @bob/blder exec tsx scripts/build-mcp-views.ts`.

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

Apply `packages/bob/src/db/drizzle/0037_mcp_oauth.sql`,
`0043_mcp_dispatch_approvals.sql` and `0045_mcp_linear_links.sql` through the existing Bob
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
pnpm --filter @bob/blder exec vitest run src/server/mcp/ worker/sdlc/mcp.test.ts worker/sdlc/routes.test.ts
pnpm --filter @bob/blder typecheck
pnpm --filter @bob/blder build
```
