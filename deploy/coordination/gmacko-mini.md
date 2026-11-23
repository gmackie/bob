# Second environment rollout (BOB-56)

Status: **not deployed or accepted by this change**. This is the rollout and
evidence checklist for adding gmacko-mini to the existing Hetzner coordinator.
Use the [installation guide](README.md) for private file ownership, backups,
service configuration and database rollback.

## Preflight recorded on 2026-11-20

- Kanbanger BOB-55 reads `Done`; its final receipt identifies active production
  deployment `manual:eb61f476-7544-4893-8230-400a469a83c9:44e941185a694d35b072b25097fe8b5e`.
  Its comments record dependency, duplicate-admission, restart and terminal
  receipt verification on Hetzner.
- T3CODE-25 reads `In Review`. BOB-55 records successful deployment and capability
  negotiation of its durable admission implementation. Reconcile the release
  prerequisite with the exact artifact selected for both hosts before cutover.
- `bob-coordinator`, `bob-coordinator-worker` and `t3code-bob` are active.
  Hetzner's environment ID is `22f02e88-2b03-45f0-99cb-85a082c6dfe2`.
- The effective T3 unit selects
  `/opt/t3code-releases/T3CODE-114-normal-1657/runtime/t3-0.1.10-gmacko.202611180453-linux-x64/t3`.
  Inspect the effective unit again at deployment time; historical receipts do
  not identify the current release selection.
- Tailscale lists gmacko-mini at `100.82.189.9`. SSH reaches it, but the current
  bob credential is refused for `mackieg`. No T3 environment link was present;
  a connection card was requested. Neither observation establishes its T3
  environment ID, architecture, installed release or admission capabilities.
- Coordinator policy and bindings contain only Hetzner targets. Their root-owned
  files are not writable by this session; `sudo -n` is refused because the
  process has `no new privileges` set.

No production bindings, principals, services or receipts were changed during
this preflight. Mac deployment access and privileged Hetzner configuration
access remain required; a T3 link alone does not grant shell or root access.

## Install and enroll

1. Inspect the Mac's actual T3 service, state directory, environment identity,
   architecture, disk space and active executions. Distinguish its native
   server from the OODA port-3774 reverse tunnel documented in
   [the runner guide](../../docs/operations/gmacko-mini-ooda-runner.md).
   Dispatch must reach the Mac's own server and repository, not Hetzner through
   that tunnel. Do not copy Hetzner's state directory or environment identity.
2. Select matching gmacko release/source revisions for both platforms with
   T3CODE-25 included. Record version, source revision and platform archive
   SHA256 for each. Preserve the previous Mac executable/service configuration;
   take consistent SQLite backups and test migration on copies before switching.
   Quiesce active work before a service restart. Retain the existing provider
   configuration and gateway ownership; install no additional execution daemon.
3. Register a disposable local pilot repository in the Mac T3 server and read
   back its project ID. Build an exact `ExecutionTarget` from the server's own
   environment ID, project ID and repository identity. Never infer the
   environment ID from its hostname or Tailscale address.
4. Back up Hetzner's private `context.json`, `principals.json` and `bindings.json`.
   Add the Mac target to the worker and authorized supervisor policy. Create a
   distinct random receipt token (at least 32 characters), with the same
   workspace/actor, an explicit Mac target policy, only
   `RecordExecutionReceipt`, and `receiptEnvironmentId` equal to the Mac ID.
   Preserve the existing Hetzner principal and its environment restriction.
5. Add an exact Mac target binding using a Mac-issued bearer session with
   `orchestration:read` and `orchestration:operate`. Preserve its authenticated
   subject during rotation so FindExecution can recover prior admissions.
   Keep the server loopback-only behind a private Tailscale HTTPS proxy (or an
   authenticated loopback tunnel). Verify Authorization and WebSocket upgrade
   forwarding. Do not use unencrypted HTTP to a non-loopback address or expose
   a public unauthenticated listener.
6. Configure the Mac's `<T3 state directory>/bob-coordination.json` using the
   selected T3 release's `docs/operations/bob-coordination.md`. Set `projects`
   to its exact target and authorized Kanbanger issue project; pin an available
   local provider/model in `executionProfiles`. Set `coordinator` to a query
   principal and `receiptCoordinator` to the new Mac receipt principal. Use the
   coordinator base URL `https://hetzner-bob.tail1e1a32.ts.net:8444` (not `/mcp`)
   after verifying its REST routes from the Mac. Store credentials only in
   private operator files, never this repository or acceptance output.
7. Validate private JSON and policy matches before restarting affected services.
   Read capabilities through each exact binding: both must advertise durable
   SubmitExecution and FindExecution. Check unauthenticated requests are refused
   and a Mac receipt principal cannot record a Hetzner receipt. Capability
   failure stops enrollment; never fall back to thread launch.

## Two-environment acceptance

Use two fresh disposable Kanbanger issues in the authorized Bob project; do not
reuse the closed BOB-55 pilot issues. Record issue UUIDs and identifiers.

1. Create one two-item plan: A targets Hetzner; B targets the Mac and depends on
   A's `execution-succeeded` milestone. Both items use `completionTarget` set to
   `execution`, so release automation cannot move the issues to Done. Use small
   deterministic file-writing tasks in disposable repositories and retain the
   command/request payloads privately for exact replay.
2. Verify B cannot execute before A succeeds. Dispatch A, read back its terminal
   receipt, then dispatch B and read back its terminal receipt. For each, retain
   plan/item/request/attempt/environment/execution/thread IDs, receipt event and
   sequence, immutable checkpoint/tree digest and evidence-bundle location.
   Verify expected artifact contents on the host that actually executed it.
3. Drain lifecycle effects. Read both issues and comments back from Kanbanger:
   both must be `In Progress`, each with exactly one terminal receipt marker
   `bob-coordination-effect: <attemptId>:execution-succeeded` and matching
   environment/checkpoint evidence. Record comment IDs as well as their text.
4. Replay exact CreatePlan, execution requests and terminal receipt payloads;
   expect stable responses and no extra attempts, admissions or comments.
   Restart coordinator/worker and each T3 server only after checking unrelated
   active work. Repeat lookup and replay on both hosts, including a receipt
   awaiting delivery across a T3 restart.
5. Exercise interrupted dispatch recovery for each binding in the disposable
   pilot: lose an admission response, restart the worker and let its lease
   expire. Verify FindExecution recovers the same admission and exactly one
   execution exists. An unavailable target must retain unknown state and its
   slot; the other host must never receive that request automatically.

Save redacted evidence with timestamp, exact runtime hashes, service invocations,
plan/attempt identities, before/after counts and Kanbanger read-backs. Do not mark
BOB-56 or parent BOB-41 accepted from capability checks or unit tests alone.

## Explicit cross-host handoff

Attempts and admitted plan scope are immutable. The current `RetryItem`
implementation creates fresh IDs but retains the previous request's target;
it is not a host-selection API. `UpdatePlan` refuses edits after any admission.

Reconcile the old execution to a confirmed terminal outcome first. For a
deliberate move, create a replacement plan/item naming the new exact target and
a fresh request/attempt, recording the predecessor plan/item/attempt and reason
in its work instructions and operator evidence. Rebuild any necessary dependency
links explicitly. Do not redirect an old binding, rewrite SQLite, reuse a
request ID with another target or launch a replacement while execution is unknown.

## Rollback

Stop new Mac admissions and reconcile accepted work before removing its target.
Preserve pending receipts and evidence. Restore the backed-up policy/bindings
and remove the Mac principal only after receipt delivery is settled. If the Mac
runtime must be rolled back, stop its service and restore its matching executable,
service configuration and consistent database backups, retaining a fresh backup
first. Database restore loses later accepted work; never use it to hide an
uncertain attempt. Verify Hetzner dispatch and receipt delivery remain healthy.
