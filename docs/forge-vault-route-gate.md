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

## Filesystem boundary qualification

Vault file helpers now resolve each existing path component under the canonical
vault root. External or dangling aliases and `.git` paths (including aliases to
Git metadata) are rejected for reads and mutations. Internal directory aliases
remain usable; replacing or deleting a final file alias preserves the prior
entry-level semantics rather than modifying its target. Listings exclude Git
metadata and do not follow symlink directory trees.

Atomic writes use a random exclusive temporary file instead of the predictable
`<path>.tmp` name. A preexisting symlink at that old name cannot redirect a write.
These checks assume the host owns the directory tree and excludes concurrent
untrusted filesystem changes. They do not provide kernel-level protection
against a malicious process swapping directories between validation and use;
that is another reason to fence legacy writers before enabling the host.

The regressions reproduced the external-alias read/write failures before the
fix. Validation after the fix: 96 vault/router tests passed and OODA typecheck
passed. Normal-route live deployment and external payload disposition remain
open; no source vault or production configuration was changed.

## Persistent admissions and runner completion (2026-10-03)

Node hosts may inject `PersistentVaultGate` into `VaultRouteHost`. Its SQLite
file must be an absolute path on a persistent local volume shared by every
cooperating host, outside the vault and its Git exports. Operations claim the
generation atomically before touching files and release it after service
completion. Competing processes fail closed. Closure persists across restart;
a closed, drained generation can advance once to a previously unused identity.
There is no lease expiry or automatic orphan takeover. A killed holder blocks
new operations and generation advancement, even after its provider receipt has
been recovered. Independent hosts and legacy Git clients need separate fencing.

The runner accepts a trusted `RunnerVaultPublication` binding using that same
gate and provider. Both manual promotions and Bob outcome callbacks use it.
Only a published receipt permits completion. A promotion error or uncertain
publication closes the generation before releasing admission, preventing the
polling loop from creating duplicate notes. Reconciliation must retain the
original note, provenance and receipt; do not reissue the original promotion.
The default runner path remains unchanged until a host supplies the binding.

The process-kill regression terminates a child after a controlled provider has
recorded dispatch. Its prepared application intent survives; restart uses
recovery only, keeps an observed head indeterminate, accepts an explicit receipt,
and does not clear the orphan admission. This verifies process loss, not host
power loss or distributed failover.

`docs/evidence/forge-vault-routes-live-2026-10-03.json` records eight passing
checks on the existing runner in an isolated Node container using live Artifacts
and D1. The HTTP fixture calls actual vault procedures with a trusted fixture
actor. Anonymous requests and writes after durable closure are rejected.
Production session authentication, route activation and legacy-writer shutdown
are not established by this fixture. All disposable cloud resources were deleted.

Offline orphan recovery requires stopping every process with workspace access,
retaining files and journals, reconciling original operations against provider
receipts, and preparing a fresh exclusively owned workspace/control database.
Never delete an admission from a database still used by any process or revive
the old generation. An unresolved provider request remains unresolved after its
originating process is gone. Validation: 248 runner tests, 100 vault/router tests
(99 in the full run plus the process-kill regression), and both typechecks.

## Node startup configuration

The Node web app now obtains the configured host for tRPC, REST and server-side
calls. The runner loads the same configuration before starting and rejects a
storage-root mismatch. Set `OODA_FORGE_VAULT_CONFIG` to an absolute operator-owned
JSON file. Absence preserves the existing disabled behavior; an empty path,
invalid file or failed initialization is an error, never a legacy fallback.
The first initialization result, including failure, is pinned for the process.

The strict version-1 configuration has `tenant`, `actor`, `artifact`, `generation`,
`repositoryId`, `kind` (`personal` or `research`), `vaultPath`, `gatePath`,
`journalPath`, and `clientModule`. Paths must be absolute and already exist.
The gate is an existing initialized SQLite database for that exact generation;
startup cannot silently recreate missing state. The journal is an external
persistent directory. Config, gate, client module and journal must be outside
the published vault; executable/configuration files cannot live in the journal.

`clientModule` is a trusted deployed ESM module exporting
`async createVaultClient(config): ForgeVaultClient`. It receives frozen canonical
paths and identity. It owns authorization and credential resolution and must
transfer prepared objects before publication. Build/deploy this module separately;
never derive its path or credentials from an HTTP request. Configuration is not
proof that an arbitrary client implementation is qualified.

The runner closes and drains the configured generation during shutdown even if
its own stop routine fails. Since closure is durable, ordinary restart does not
reopen it: the operator must complete reconciliation and advance to a new
non-reused generation. Independent machines need separate writer fencing.
The Cloudflare edge app deliberately excludes filesystem vault routes and is
not switched to this Node-only module. Enabling production still requires a
Node route destination and a qualified deployed client module.

Startup validation: 103 vault/router tests passed, including loss of control
state, identity mismatch, authorization before file writes and failure caching.
OODA, runner and Node-web typechecks passed. A clean checkout of revision
`41f1e3ee797cc3582254f3fb765a4b46ce17705f` built successfully with Node 24.14.0
and `next build --webpack` in an isolated container on the existing runner.
The built application returned 401 for anonymous vault access and 500 for an
invalid configured host. The smoke containers were removed. No production
authentication secret, database or vault was used by this build/smoke check.
The default Turbopack path still has existing shared-auth `.js` source-resolution
errors; use the configured webpack build for this Node deployment.

Live topology inspection found that the OODA runner points at the edge service
and stores threads in `/home/bob/.ooda/threads`, separately from the personal
Obsidian vault. Do not change that root merely to activate a personal vault.
The startup root-match guard intentionally rejects such a mixed configuration.
