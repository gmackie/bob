# Bob mobile tasks on the always-on T3 server

Tracked by BOB-40 and T3CODE-5. Bob's OODA gateway runner owns task claims,
worktree preparation, run reporting and PR finalization. Configure that existing
runner with `OODA_T3CODE_SERVER_URL=http://127.0.0.1:3773` and
`OODA_T3CODE_AUTH_TOKEN` from the server's protected credential store to execute
its gateway tasks in T3. Do not start a second execution daemon in its workspace.
Without the URL, existing local adapters remain selected. A URL without a token
fails startup validation.

`OODA_T3CODE_MODEL_INSTANCE_ID` and `OODA_T3CODE_MODEL` optionally choose the
server provider/model. Otherwise the task's agent maps to a T3 provider and its
server-advertised default model; a persona model remains explicit. Task permission
mode is preserved. Tool allowlists unsupported by T3 reject the handoff rather
than broadening access. Legacy project ID/runtime-mode variables do not override
repository identity or the task's permission boundary.

The bridge uses protocol 2: bearer-authenticated websocket tickets and Effect RPC
`orchestration.launchThread`, `getThreadProjection`, and `dispatchCommand`.
Project identity is matched by repository root, and the runner-prepared worktree
is bound before execution. Stable command/thread/message IDs make launch retries
idempotent. Output and permission prompts use the supervisor's journal, allowing
adoption after runner restarts. Stop uses a control message; the bridge stays
alive until T3 reports termination. Network loss retains the worktree and retries
observation instead of reporting a false completion. Single pending input
questions accept a Bob follow-up; multiple questions and unsupported request kinds
currently need the T3 server thread and are reported explicitly.

Both services must see the same worktree path. The T3 systemd service uses
PrivateTmp, so `/tmp` is unsuitable; use the existing `/home/bob/.bob/worktrees`
location. T3 remains loopback-only. That location is a symlink onto a mounted
volume, so `t3code-bob.service` also needs the volume in `ReadWritePaths`; see
`docs/ops/hetzner-bob-runtime-verify.md` ("Worktree volume write access").

## Codex compatibility prerequisite

On 2026-10-10 T3 `0.0.45-gmacko.202610070116` rejected installed Codex `0.135.0`
thread/start responses because `thread.projectId` was missing. T3CODE-5 installs
Codex `0.162.1` separately under `/home/bob/.local/share/t3-codex-0.162.1` and
prepends its `node_modules/.bin` directory in the T3-only systemd drop-in
`/etc/systemd/system/t3code-bob.service.d/codex-runtime.conf`. The prior system
CLI remains installed. Roll back by removing that drop-in, reloading systemd and
restarting T3 after checking for active work.

The shared-worktree probe completed with `BOB_SERVER_T3_HANDOFF_OK` in thread
`bob-7c03145b196274816db3418f00e5cb1d`; replaying the same session returned the
same completed run. This proves the server bridge boundary, not the full mobile
production flow. Keep BOB-40 open until merged runner/mobile code, TestFlight,
and a mobile task through Kanbanger/T3/ForgeGraph are verified.

## Durable factory coordinator (BOB-55 / BOB-68)

The standalone coordinator has its own REST/MCP listener and SQLite database.
Install the checked-in [coordinator systemd units and operator configuration](../../deploy/coordination/README.md).
The OODA runner remains the gateway daemon owner. Native coordinator requests
use T3's durable admission API; they do not start a second gateway daemon.

On 2026-11-12, `t3code-bob.service` switched to
`/opt/t3code-releases/BOB-55/runtime/t3-0.1.7-gmacko.202611081333-linux-x64/t3`.
The published Linux archive SHA256 was
`38753a9e07c63c98feba66ddba52b9cbe00be87acb068a6b809e1a02d7de8829`.
The worktree-volume, Codex and CLI proxy drop-ins were retained. The old runtime
at `/opt/t3code-runtime-T3CODE-11-f6f3d94e/t3` remains installed.

Before switching, the new CLI read a SQLite backup in an isolated data directory
and a fresh isolated server advertised durable `SubmitExecution` and
`FindExecution`. The gateway owner was stopped briefly, all T3 runs were checked
terminal, and the production databases were backed up through SQLite's backup
API. The existing gateway bearer credential still authenticated after restart.
The old CLI also read the isolated migration snapshot successfully.

On 2026-11-16 (T3CODE-114, Bob execution publishing), `t3code-bob.service` switched
to `/opt/t3code-releases/T3CODE-114/runtime/t3-0.1.9-gmacko.202611162207-linux-x64/t3`.
The nightly release could not publish because the macOS builds were blocked by
the free-disk guard on gmacko-mini, so this runtime archive was built on
hetzner-bob from merged t3code commit
`06e6c29170e745705b58a8704161c52a484b3462` with the release workflow's Linux steps
(desktop AppImage skipped) and passed `scripts/smoke-cli-archive.ts`. Its SHA256 is
`07983a4532a7a6549db4a13b8df7044450f32fc7b24061588cdb4a82da6b68a8`.
The BOB-55 runtime remains installed.

Migrations 82 to 99, including `099 BobExecutionPublications`, were applied first
to SQLite backup copies in an isolated data directory and then to the live
databases. The gateway owner and T3 were stopped, all T3 runs were checked
terminal, and all four databases were backed up through SQLite's backup API.
The rollback snapshot is `/root/T3CODE-114-rollback` (the four databases and the
previous `runtime.conf`); restore it the same way as the BOB-55 snapshot described
below.

The T3CODE-114 runtime recognizes `git.forgegraf.com` remotes as the ForgeGraph
source-control provider. Until 2026-11-18 its ForgeGraph login for `bob`
(`/home/bob/.forgegraph/credentials.json`) was refused, so T3 pushed a run's branch
but could not open its pull request, and Bob's coordinator opened the PR with its
own Forgejo token (BOB-86, PR #304). On 2026-11-18 that login was replaced with an
admin-scope ForgeGraph token with a 90-day expiry, which restores T3-side PR
creation. The coordinator's Forgejo fallback remains for runs whose publication
is skipped.

On 2026-11-17 (T3CODE-117), `t3code-bob.service` switched to
`/opt/t3code-releases/T3CODE-117/runtime/t3-0.1.9-gmacko.202611170109-linux-x64/t3`,
built on hetzner-bob the same way from t3code commit
`6e519a3212740e5d20b9898c2185f52bfe9fd2d2`. The archive SHA256 is
`b3839af5c8bdcc7ec3e6413d0d1758a2870e685218afb7aa943f944d58afb5f4`.
The rollback snapshot is `/root/T3CODE-117-rollback`.

On 2026-11-18 (T3CODE-116, receipts for runs that fail before a checkpoint),
`t3code-bob.service` switched to
`/opt/t3code-releases/T3CODE-116/runtime/t3-0.1.10-gmacko.202611180213-linux-x64/t3`,
built on hetzner-bob from t3code commit
`88ceb783f6650483a08fe527ac46e22b1193835f`. The archive SHA256 is
`18adc508e08c3d8f4edd8a468f2bb1dd31c5667cca32e0bc4f44e50df913a6df`.
The rollback snapshot is `/root/T3CODE-116-rollback` (the four databases and the
previous `runtime.conf`). With it, a run that fails before any checkpoint (for
example in workspace preparation) sends a failed terminal receipt instead of
leaving the coordinator item running.

On 2026-11-18 the Forgejo token that was embedded in the `origin` URLs of the
repositories under `/home/bob/forge/` was moved into bob's git credential store
(`/home/bob/.config/git/credentials`, mode 0600, configured as
`credential.https://git.forgegraf.com.helper`) and rotated, so `git remote -v` no
longer shows a credential. The coordinator's Forgejo release token in
`/etc/bob/coordination/release.json` was rotated to one that also has `write:issue`,
so it can comment when it closes a superseded pull request. Pre-rotation copies
are kept root-only in `/root`. Never write a token value into this runbook.

An inherited migration-32 name conflict remains visible in T3's warning output:
`ProjectionThreadsExternalTask` versus `AuthPairingProofKeyThumbprint`. Both
`projection_threads.external_task_json` and
`auth_pairing_links.proof_key_thumbprint` were present on this host; do not edit
migration history to conceal the warning. Check these columns when repeating
this upgrade on a different installation.

The private rollback snapshot is `/root/BOB-55-rollback`, including the previous
`runtime.conf` and both SQLite databases. To revert a migration, first stop the
gateway owner and T3, then restore the matching database snapshots and their
bob ownership, remove only their stale WAL/SHM files while stopped, restore the
runtime drop-in, reload systemd, and start T3 and the gateway owner. Restoring
a snapshot loses changes accepted since that snapshot: check for new work and
retain a fresh backup before proceeding.

Bob's coordinator is at `127.0.0.1:4780`; the private remote MCP URL is
`https://hetzner-bob.tail1e1a32.ts.net:8444/mcp`. T3's existing private web listener
stays on port 8443. The `bob-factory` remote tool on Bob uses the loopback MCP
URL, with Authorization in T3's sensitive header storage. Its initial execution
policy is limited to the disposable factory acceptance project and the Bob
Kanbanger project. Expanding repository access requires explicit project/target
bindings and corresponding T3 configuration.
