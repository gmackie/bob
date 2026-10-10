# Bob coordination contract

The canonical wire model is [src/contract.forge](src/contract.forge). ForgeC
generates the OpenAPI 3.1 document, ForgeGraph contract IR and typed TypeScript
client in `generated/`. T3 can consume these without importing Bob's runtime.

This package defines the shared contract and an opt-in local plan admission
adapter. It installs no HTTP handlers, scheduler, provider process, integration
writes or deployments. Bob owns coordination; each T3 environment owns its
execution. Parent work: BOB-41 and T3CODE-6. Contract publication: BOB-42. Local durable admission: BOB-43. Execution recovery: BOB-44.

## Verify and generate

Requires Node 24+, Git and Rust/Cargo 1.97+. The compiler source is pinned in
`compiler.json`; the generator builds that exact source in a temporary cache,
rather than modifying an installed ForgeC. It includes the FORG-1 nested-shape
fix. A local developer can supply `FORGEC=/absolute/path/to/forgec` of the pinned
version; output equality and schema fixtures must still pass.

```sh
npm ci
npm run verify
npm run generate   # only after intentional .forge changes
```

Commit generated artifacts. Verification rebuilds into a disposable directory
and compares each byte; a successful compiler exit alone is insufficient because
the compiler can warn and omit `contract.json`. CI builds the pinned compiler,
checks artifacts, runs wire and durable admission fixtures and checks the
generated client's types.

## Binding the contract

The ForgeC projection uses typed per-operation inputs instead of the initial
draft's generic `kind/payload` command envelope. Input fields still carry stable
`commandId` or `requestId`. Function bindings return HTTP 200 with an Operation;
its `accepted` state means asynchronous admission, never completed work. Queries
are typed POST functions in this slice. GetPlan/GetItem return current state and
a cursor captured atomically with the snapshot. ReadEvents resumes after that
cursor; consumers fetch changed resources and recover expired cursors by loading
a fresh snapshot. The runtime must implement this atomic snapshot boundary. The later runtime must bind these
semantics rather than claim the draft's 202/GET paths already exist.

Calls target the coordinator base URL for management, or the explicitly selected
T3 environment base URL for execution. All requests require server-derived actor
and workspace authorization. The generated client exposes wider Forge
administrative helpers; consumers must use only the coordination operations
listed in the contract, not infer administrative authority from client methods.

Command adapters must require Idempotency-Key to equal commandId/requestId;
receipt adapters deduplicate eventId. For commands,
store the fingerprint and receipt atomically, and replay before evaluating stale
expectedVersion. Generated optional headers do not implement this requirement.

Nested identities and bounded lists are validated by generated schemas. The local
adapter enforces configured project/environment policy and dependency DAGs. Later
execution adapters must bind trusted environment identity and enforce cancellation
races and production evidence provenance. The local execution adapter below checks
dirty-tree patch evidence, identity, state transitions and receipt sequence gaps.
Local fixtures do not establish a deployed environment's admission guarantees or
production delivery.

Use the scenario catalog in [adapter-scenarios.json](adapter-scenarios.json) as the
next runtime adapter acceptance surface. Scenarios are documented obligations,
not simulated passing runtime tests. Preserve CLIAPIProxy/Pistache configuration
as environment-local profiles; no credentials enter coordination payloads.

## Retry, recovery and evidence invariants

- Transport retries preserve IDs and payloads; deliberate work retry creates a
  new attempt after its predecessor is confirmed terminal.
- Unknown execution occupies capacity and cannot silently fail over.
- Plan edits pin version and scope; schedules fire a typed Bob trigger.
- Dependencies explicitly name execution, review, merge or production milestones.
- Execution and validation receipts never certify production.
- Validate the immutable source snapshot, approve checks for the exact current
  PR head, and require intended stage + artifact + deployment + health evidence.
- Deduplicate receipts after durable commit. Old-attempt facts remain history
  without advancing a newer attempt; reconnect resumes from a snapshot watermark.

## Local durable admission and CLI

The opt-in `runtime/coordinator.mjs` adapter uses Node 24's built-in SQLite and
ForgeC-generated D1 SQL from `storage/src/model.forge`. The PostgreSQL projection
is generated for review only; no PostgreSQL adapter or production migration is
enabled. Database version 2 is initialized once; the generated attempt migration upgrades
version 1 transactionally. Unsupported versions fail.
The local store and policy file are owned by the local operator. No network
listener or client-supplied actor/workspace is accepted.

CreatePlan, UpdatePlan and ControlPlan commit plan/items, resource events, pending
notifications and a scoped command receipt together under `BEGIN IMMEDIATE`.
An operation's `succeeded` state certifies the management command persisted,
not issue execution or production completion. IDs are scoped by trusted workspace
and actor. Replays recheck current authorization, then return the original
operation before evaluating stale versions; changed command payloads conflict.
Commands retain receipts and events without pruning in this first slice.

The same adapter implements GetPlan, GetItem, GetOperation, ReadEvents and
GetCapabilities. Snapshot watermarks are read in the same transaction as state.
Cursors bind to the trusted workspace/actor; event pages are bounded. Pending
notifications survive restart. The base Coordinator exposes plan admission only;
the opt-in ExecutionCoordinator and CLI additionally support execution below.
Capabilities list only implemented operations and no execution/validation
profiles. Bob advertises durableExecutionAdmission=false: it coordinates work
but is not an environment admission server. Unsupported operations fail with CapabilityUnavailable.

Provide an operator-owned policy JSON file with `workspaceId`, `actorId`,
`targets` (exact ExecutionTarget objects) and `issueProjects` (integrationId,
workspaceId, teamId, projectId). Requests are the generated ForgeC input shapes:

```sh
npm run coordinate -- CreatePlan --database ./coordination.sqlite \
  --context ./policy.json --input ./create-plan.json
npm run coordinate -- GetPlan --database ./coordination.sqlite \
  --context ./policy.json --input ./plan-query.json
# --input - reads JSON from stdin. CLI defaults the key to commandId/requestId.
```

Programmatic callers must explicitly pass the commandId/requestId as idempotencyKey.
The CLI prints one response JSON to stdout or a structured error to stderr and
returns a nonzero exit code on failure. It also exports `bob-coordinate` as a
package bin for a prepared local installation.

Plans start in draft; start/pause/resume/cancel obey explicit state transitions.
Draft and paused edits require the current version. Once any attempt is
admitted, its plan definition is immutable; use a new plan for changed scope. Item IDs remain stable;
removing an admitted item is rejected until a tombstone protocol exists. A plan
can mark dependency-free items ready, but it never launches work. Plan cancellation is rejected while live attempts exist. Pausing stops
new dispatch without claiming to cancel an environment execution. Test traces
cover file-backed restart, canonical replay, rollback at two transaction phases,
separate-process concurrent version updates, isolation, authorization revocation,
DAG rejection, snapshots, pagination and CLI use.

The full adapter scenario catalog still includes unimplemented execution,
validation, release and production reconciliation. Its pending status remains
accurate; passing local plan tests does not satisfy those later scenarios.

## Execution requests, worker and receipts

`runtime/execution.mjs` provides ExecutionCoordinator, adding RequestExecution,
RetryItem and RecordExecutionReceipt to the eight plan operations. RequestExecution
uses the SubmitExecution input shape: callers provide stable request/attempt IDs,
a pinned plan version, issue snapshot, explicit target, scope, base revision and
an environment-local executionProfileId. Its Idempotency-Key equals requestId.
The transaction verifies readiness and plan capacity, reserves the item, persists
the immutable request and accepted operation, and appends resource notifications.
Capacity is execution capacity: a terminal attempt releases it, even if the issue
still needs validation, review or production delivery.

DispatchOnce claims a bounded lease, then performs network work outside the
transaction. Failed/lost/invalid responses mark execution unknown and keep the
reservation. After the lease expires, recovery calls FindExecution first; only
an explicit authenticated 404 permits replaying SubmitExecution with identical
IDs and payload. It never creates a replacement attempt or switches environments.
An expired competing worker cannot apply stale admission. Local persisted leases
also survive a process crash during dispatch.

The HTTP port requires an exact configured ExecutionTarget and positive
capabilities: durableExecutionAdmission=true, SubmitExecution, FindExecution and
the chosen executionProfileId. The remote endpoint must atomically deduplicate
admission and honor lookup consistency. This worker cannot prove that guarantee
for a server; capability declaration and environment conformance are prerequisites.
The existing T3 thread.create/turn.start route does not qualify and is not used.
A native T3 admission endpoint remains work under T3CODE-6. No deployed server
is enabled or claimed compatible by this slice.

```sh
npm run coordinate -- RequestExecution --database ./coordination.sqlite \
  --context ./policy.json --input ./execution-request.json
npm run coordinate -- DispatchOnce --database ./coordination.sqlite \
  --context ./policy.json --bindings ./environment-bindings.json
```

Bindings are an operator-owned array of `{ target, baseUrl, authToken? }`, with
credentials held outside command payloads/database. Requests have a timeout and
refuse redirects. DispatchOnce runs once, without a recurring scheduler, and
prints a structured result (including unknown state when admission is uncertain).

RecordExecutionReceipt requires a trusted `receiptEnvironmentId` in host context
matching the receipt environment. A future network host must derive this field
from authenticated environment identity; it must not copy it from the request.
Admission execution/thread/repository identity, dirty-tree patch evidence and
receipt sequence are checked before recording a terminal fact. The receipt stream
is per attempt, beginning at 1; this slice has a single terminal receipt and
rejects gaps rather than inventing omitted facts. Exact event replay is stable;
conflicting terminal facts fail. All fact/state/operation/event/receipt updates
commit together. A failed/cancelled current attempt can be retried explicitly
with the current item version and predecessor ID; the transaction creates fresh
request/attempt IDs and preserves the old terminal fact.

Success records execution-succeeded and releases dependencies requiring that
milestone. An execution-target item completes; review/merge/production items
remain validating. Later milestone dependencies stay pending. Pause/resume retains
attempt outcomes and recomputes ready dependencies in the plan transaction.
Validation, release, production reconciliation and execution cancellation remain
unimplemented; no execution receipt closes a production issue.
