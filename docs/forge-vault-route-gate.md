# Forge vault route qualification

The vault router accepts a trusted `VaultRouteHost` through `createTRPCContext`.
The host is created once per workspace generation and shared by all requests;
it binds authenticated actor IDs and vault kinds to preconfigured `VaultService`
instances. Each service owns its workspace path and selected publication port.
Request input cannot select a path, provider, actor, or generation.

All six vault procedures require authentication, including list, read and health.
When a host is configured, missing actor/kind bindings fail closed. Service
errors never fall through to the environment-selected legacy Git path. With no
host, authenticated requests retain the existing environment configuration.
Writes and promotions retain their existing response shape; `success` means the
operation completed, while `publication.state` determines durable publication.
In particular, an observed Forge head remains indeterminate, not published.
Hosted health reports local workspace readiness only, not provider reachability.

`closeAndDrain()` synchronously and permanently closes new admissions, then waits
for admitted operations, including queued operations and failed operations.
The queue covers the entire service call (file write, commit, replay and publish),
so concurrent route writes cannot be folded into each other's working-tree
commits. Reads are also queued to avoid observing partially completed calls.
An old host cannot reopen when a replacement host is created.

This gate is process-local. The hosting application must await drainage before
switching workspace generations and must separately stop legacy writers, fence
other processes, and reconcile uncertain publications. Drain completion does
not establish acceptance of a timed-out provider write. Do not discard old
journals, reset old refs, or revoke recovery access based only on this gate.
A process crash does not persist the gate's closed state.

Qualification uses the real tRPC caller, VaultService, ForgePublicationStorage,
local files, and publication journal with a controlled provider client. It covers
actor rejection on all routes, host precedence, no local sync fallback,
indeterminate outcomes, an in-flight publication during close, stale callers,
queue drainage after failures, and immutable identity bindings. This is local
route qualification, not a deployed end-to-end provider test. No production
host is configured by this change; runner completion routes remain a separate
integration surface.

Validation: 90 tests passed across the vault suite and both vault router suites;
`pnpm --filter @gmacko/ooda typecheck` passed (Node 24.14.0).
