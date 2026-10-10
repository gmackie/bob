# Bob coordination contract

The canonical wire model is [src/contract.forge](src/contract.forge). ForgeC
generates the OpenAPI 3.1 document, ForgeGraph contract IR and typed TypeScript
client in `generated/`. T3 can consume these without importing Bob's runtime.

This package defines contracts only. It installs no HTTP handlers, storage,
scheduler, provider process, integration writes or deployments. Bob owns
coordination; each T3 environment owns its execution. Parent work: BOB-41 and
T3CODE-6. This publication slice: BOB-42.

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
checks artifacts, runs wire fixtures and checks the generated client's types.

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

An adapter must require Idempotency-Key to equal commandId/requestId for mutations,
store the fingerprint and receipt atomically, and replay before evaluating stale
expectedVersion. Generated optional headers do not implement this requirement.

Nested identities and bounded lists are validated by generated schemas. Domain
checks remain adapter obligations: project/environment authorization, dependency
cycles, dirty-tree patch evidence, thread/target identity equality, legal state
transitions, sequence gaps, cancellation races and production evidence provenance.
No fixture passing here is proof of durable dispatch or production delivery.

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
