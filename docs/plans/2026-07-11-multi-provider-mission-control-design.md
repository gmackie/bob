# Multi-provider mission control design

## Goal

Make Bob a provider-neutral mission-control surface for Claude Code, Codex,
Grok Build, and Cursor Agent. The web app at `bob.blder.bot` and the Bob mobile
app must be able to start, observe, control, and resume work running on
`hetzner-bob`, with `vanuc` and `labnuc` able to join later through the same
host contract.

Provider credentials remain on each execution host. Bob reports provider
allowances only when a provider exposes authoritative values and keeps those
separate from usage observed by Bob.

## Architecture

Each execution machine runs one Bob daemon. It owns local CLI processes and
credentials and connects outbound to Bob's authenticated gateway. No execution
host needs a public control port, and neither the web nor mobile client receives
provider credentials or SSH access.

The daemon implements a provider-neutral contract with provider-specific
capabilities:

- capability discovery: CLI version, authentication, supported controls, and
  supported telemetry;
- execution: start, stream, send input or approval, cancel, retry, and resume
  where supported;
- telemetry: provider-reported limits and reset windows when available, plus
  Bob-observed tokens, cost, duration, and run counts;
- health: heartbeat, daemon version, active worktrees, queue depth, and the last
  provider probe.

Claude, Codex, Grok, and Cursor retain native session identifiers and raw event
payloads for diagnostics, but all clients consume normalized lifecycle and
usage events. Adding a host requires registering it and installing the daemon,
not adding another application architecture.

## Authentication and authorization

`bob.blder.bot` keeps the existing Better Auth boundary. Chrome retains the web
session cookie; credentials are not copied into Bob's backend or execution
hosts. Mobile authenticates as the same Bob identity using its own secure
session stored in Keychain or the Android Keystore.

Every execution host has a separate revocable host credential. Every control
request is authorized by workspace membership and audited with user, device,
host, run, and action. Repository and worktree allowlists are validated on the
host before process creation. Destructive approvals remain explicit and are
never inferred from a disconnected client.

## Command and event flow

1. A client creates a run for a repository, host, provider, and worktree.
2. Bob persists the command before delivering it to the selected connected
   host.
3. The daemon validates the target and starts the authenticated local CLI.
4. Output, lifecycle, approval, usage, and error events return as an ordered
   stream.
5. Web and mobile consume the same persisted stream and reconnect from their
   last acknowledged sequence.
6. Follow-up, approval, cancellation, and retry commands use idempotency keys.

Agents continue when a client disconnects. During a gateway outage, the daemon
buffers events locally and replays them from the last acknowledged sequence.
Host and provider states distinguish offline, daemon unhealthy, unauthenticated,
quota limited, and run failed.

## Provider adapters

Each adapter declares capability flags for interactive approval, resume,
structured token usage, provider quota, reset time, direct cost, and model
identity.

- Claude uses streaming JSON, native session identifiers, structured usage,
  tool events, and permission events.
- Codex uses `codex exec`, machine-local ChatGPT or API authentication, JSON
  events, and native resumable state where supported.
- Grok uses the official Grok Build CLI, device-code or browser authentication,
  headless execution, and streaming JSON.
- Cursor uses browser-authenticated `cursor-agent`, stream JSON print mode, and
  native chat identifiers for resume.

The adapter boundary is version-probed and fixture-tested so CLI drift produces
an explicit degraded capability instead of corrupting run state.

## Usage and limits

Usage values include their source (`provider`, `bob_metered`, or `estimated`),
collection time, optional reset period, and collection error. Provider-reported
values take precedence. Bob-metered totals include completed and interrupted
runs. Cost appears only when directly reported or calculated using an explicitly
versioned price table, in which case it is visibly labeled estimated.

Clients must display unavailable and stale states honestly. For example, a
provider card may show that its allowance is unavailable while Bob observed a
specific token total this week. Bob does not infer a remaining subscription
quota from locally observed tokens.

## Verification and acceptance

Adapter contract tests cover valid and malformed streams, usage extraction,
approval events, rate limits, interruption, resume identifiers, and CLI version
drift. Gateway tests cover ordered delivery, idempotent controls,
reconnect/replay, authorization, and cross-user isolation. UI tests cover stale
or unavailable telemetry and capability-based control enablement.

On `hetzner-bob`, all four CLIs must be installed and authenticated under the
daemon's actual service account. Each provider must complete a harmless real
repository task, stream output through Bob, persist its final state, and report
observed usage. Acceptance also includes cancellation and gateway reconnect
with replay. A checked-in verifier and runbook make this repeatable on future
hosts.

Web acceptance uses the existing Chrome session on `bob.blder.bot` to observe
host health, start a run, receive streaming progress, send a follow-up, and
confirm final usage.

Mobile acceptance uses deterministic Maestro flows against the shared backend
on both an Android emulator and iPhone simulator. The flow authenticates with a
test-safe Bob account, selects `hetzner-bob`, opens or launches a real run,
observes a live event, exercises an allowed control, and verifies the
usage/limits card. Authentication bootstrap may be platform-specific, but run
data and controls may not be mocked.

The feature is complete only with fresh evidence from focused tests, the public
web deployment, Hetzner services, Android Maestro, and iOS Maestro.
