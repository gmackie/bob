# Supervise the factory from T3 Code

The durable Bob coordinator serves authenticated Streamable HTTP MCP at `/mcp`
on the same listener as its REST API. A T3 agent can submit and manage
issue-linked plans, reserve ready work for the existing dispatch worker, and
recover state after disconnects. REST and MCP share the SQLite store, trusted
principal policy, issue resolver, dependency checks and idempotent receipts.

This is the coordination service, separate from the Bob web app's OAuth MCP
endpoint at `https://bob.blder.bot/mcp`. The web endpoint manages workspace
content; it does not forward factory commands. Point T3 at the actual
coordinator host, through an authenticated private network or HTTPS reverse
proxy. Keep the coordinator loopback-only when a proxy runs on the same host.

## Connect

Start the coordinator with the existing operator-owned principal configuration
and Kanbanger resolver. Run the existing `bob-coordinate-worker` against the
same database and the same workspace/actor policy to dispatch reservations and
drain issue updates. No second scheduler or execution daemon is required.

```sh
bob-coordinate-server --database /var/lib/bob/coordination.sqlite \
  --principals /etc/bob/coordination-principals.json \
  --kanbanger /etc/bob/kanbanger.json
```

Use an existing supervisor principal or provision one with a unique bearer
credential of at least 32 characters. Store it in the operator's secret store
and T3's sensitive header storage, never in repository files or prompts. The
principal's context binds `workspaceId`, `actorId`, allowed execution `targets`
and `issueProjects`; tool arguments cannot change these grants. Configure only
the necessary operations:

```json
[
  "GetCapabilities", "ListPlans", "GetPlan", "GetItem", "GetOperation",
  "ReadEvents", "CreatePlan", "UpdatePlan", "ControlPlan",
  "RequestExecution", "RetryItem"
]
```

In T3 Settings → Tools, add a remote Streamable HTTP server named
`bob-factory`, URL `https://<coordinator-host>/mcp`, with a sensitive
`Authorization: Bearer <supervisor-credential>` header. Use bearer headers for
this operator-managed service; OAuth belongs to the separate public web MCP.
Do not configure an `Idempotency-Key` HTTP header. Each mutation carries its
own stable `commandId` or `requestId`, and Bob's MCP adapter derives the REST
admission key from it.

Browser origins are denied by default. A server-side T3 MCP connection sends no
Origin. If an approved browser client needs direct access, configure each exact
origin with repeated `--allowed-origin https://<client-host>` arguments and
configure CORS in the reverse proxy. Do not add wildcard origins.

## Run one issue, then continue

Start with `bob_get_capabilities`, `bob_list_plans` and the
`factory-supervisor` MCP prompt. Tool input schemas are generated directly from
the ForgeC contract; use `contractVersion: "1"` and preserve the complete
returned receipts. Connection instructions and the prompt include the configured
issue-project and target identities, with no principal secrets. These identify
allowed scope; they do not prove an execution host is healthy or that its
execution profiles are available. A read-only principal discovers only its
permitted queries.

1. Resolve the authorized Kanbanger issues and acceptance criteria. Choose
   operator-configured target identities and execution profiles. Create a draft
   with `bob_create_plan`; each item pins an issue snapshot, execution target and
   completion target. Dependencies name an explicit milestone. Use
   `review-ready` for a PR handoff or `production` for production work.
2. Save the exact mutation payload and command ID in durable supervisor context
   before sending it. Save the returned plan/resource/operation IDs. A lost
   response is an unknown outcome; retry the identical command, including after
   restarting the agent. A JSON-RPC request ID is not a durable mutation key.
3. Read the draft with `bob_get_plan`, then `bob_control_plan` with action
   `start` and the observed `expectedVersion`, within the user's authorization.
   Starting a plan makes eligible items ready; it does not execute them.
4. Call `bob_request_execution` for a ready item, with stable request/attempt
   IDs, the current plan version, pinned issue snapshot, scoped work and
   acceptance, base SHA, issue-named branch and execution profile. The response
   means reserved for the existing Bob worker. Never independently launch the
   same issue through T3 tools.
5. On a later wake-up, read the item/operation and use `bob_read_events` after
   the snapshot cursor. Fetch changed resources. Unknown execution continues to
   occupy capacity while the worker reconciles admission with T3. It must not
   cause a new attempt or host failover. `bob_retry_item` only retries the
   confirmed terminal failed/cancelled current attempt.
6. When a dependency's declared milestone is observed, Bob makes downstream
   work ready. The supervisor requests that work explicitly. Independent ready
   items may be reserved up to the plan's concurrency limit.
7. Present PR, current head SHA, checks and delivery evidence in a concise
   decision packet. Execution success leaves a production item `validating`;
   it never certifies review or production. The Kanbanger outbox records
   admission/receipts and never marks an issue Done from agent execution alone.

Pause with `bob_control_plan` and the observed version to stop further
dispatch. Admitted runs continue. Plan cancellation rejects while attempts
remain live. An expired event cursor requires a fresh snapshot, not restarting
work. `VersionConflict`, `CapacityUnavailable`, `ExecutionUnknown` and other
tool failures return `isError: true` with a structured code/status; unexpected
failures omit internal diagnostics. Read current state before deciding whether
to create a new command ID.

## Current boundary

The MCP adapter advertises only implemented management operations allowed by
the authenticated principal. It never exposes execution receipt submission,
even if the principal's REST policy includes it. Trusted T3 environment
callbacks keep using the separate REST receipt operation. Validation, release,
deployment and active cancellation operations exist in the wider contract but
are not implemented by this coordinator and are not advertised here.

The worker continues already-reserved work without a supervisor connection.
Selecting and reserving new items still needs a supervisor turn. Unattended
portfolio scheduling, hard spend enforcement, exact-revision delivery adapters
and automatic production completion require further work. The prompt and this
guide do not implement those controls.

## Verify

```sh
cd packages/bob/coordination
npm ci --ignore-scripts
npm run verify
```

`test/mcp.test.mjs` connects with the official MCP SDK client and proves shared
REST/MCP state, a two-item dependency plan, duplicate request replay, lost
dispatch-response recovery after restart, receipt deduplication, blocked unsafe
retry, authority and target/workspace isolation, independent production gates,
bounded requests and protocol negotiation. It uses disposable databases and no
real credentials or live tasks. It does not establish production deployment.

After deployment, verify the installed revision, authenticated MCP initialize,
tool discovery and capabilities, unauthenticated 401, worker health and a
scoped pilot issue. Retain PR/head, installed artifact/deployment identity,
target and health/protocol evidence in BOB-68 before declaring production done.
